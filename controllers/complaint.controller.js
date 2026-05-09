import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import { uploadBufferToCloudinary } from '../services/upload.service.js';
import Complaint, {
  COMPLAINT_TYPES,
  SAFETY_TYPES,
  COMPLAINT_STATUSES
} from '../models/complaint.model.js';
import { createNotification } from '../services/notification.service.js';

const uploadDocs = async (files) => {
  if (!files || !files.length) return [];
  const urls = [];
  for (const f of files) {
    const r = await uploadBufferToCloudinary(f.buffer, 'complaint-docs', 'auto');
    urls.push(r.secure_url);
  }
  return urls;
};

export const fileComplaint = catchAsync(async (req, res) => {
  const { issueType, description, sessionId, advisorId } = req.body;
  if (!COMPLAINT_TYPES.includes(issueType)) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid complaint type');
  const documents = await uploadDocs(req.files);

  const c = await Complaint.create({
    kind: 'complain',
    user: req.user._id,
    advisor: advisorId,
    session: sessionId,
    issueType,
    description: description || '',
    documents
  });
  return sendResponse(res, { statusCode: StatusCodes.CREATED, message: 'Complaint submitted', data: c });
});

export const fileSafetyReport = catchAsync(async (req, res) => {
  const { issueType, description, sessionId, advisorId } = req.body;
  if (!SAFETY_TYPES.includes(issueType)) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid safety type');
  const documents = await uploadDocs(req.files);

  const c = await Complaint.create({
    kind: 'safety_report',
    user: req.user._id,
    advisor: advisorId,
    session: sessionId,
    issueType,
    description: description || '',
    documents
  });
  return sendResponse(res, { statusCode: StatusCodes.CREATED, message: 'Safety report submitted', data: c });
});

export const myComplaints = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { user: req.user._id };
  if (req.query.kind) filter.kind = req.query.kind;
  const total = await Complaint.countDocuments(filter);
  const items = await Complaint.find(filter)
    .populate('session', 'sessionCode type')
    .sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

// ===== Admin =====
export const adminListComplaints = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = {};
  if (req.query.status) {
    if (!COMPLAINT_STATUSES.includes(req.query.status)) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid status');
    filter.status = req.query.status;
  }
  if (req.query.kind) filter.kind = req.query.kind;

  const total = await Complaint.countDocuments(filter);
  const items = await Complaint.find(filter)
    .populate('user', 'name email profilePhoto')
    .populate('advisor', 'name email profilePhoto')
    .populate('session', 'sessionCode type chargedAmount')
    .sort({ createdAt: -1 }).skip(skip).limit(limit).lean();

  // counts
  const [total_, solved, pending] = await Promise.all([
    Complaint.countDocuments({}),
    Complaint.countDocuments({ status: 'complete' }),
    Complaint.countDocuments({ status: { $in: ['pending', 'reviewing'] } })
  ]);

  return sendResponse(res, {
    data: items,
    meta: { ...buildMeta({ page, limit, total }), totals: { all: total_, solved, pending } }
  });
});

export const adminUpdateComplaintStatus = catchAsync(async (req, res) => {
  const { status, note } = req.body;
  if (!COMPLAINT_STATUSES.includes(status)) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid status');
  const c = await Complaint.findByIdAndUpdate(
    req.params.id,
    { status, resolutionNote: note || '', resolvedBy: req.user._id, resolvedAt: new Date() },
    { new: true }
  );
  if (!c) throw new ApiError(StatusCodes.NOT_FOUND, 'Complaint not found');

  await createNotification({
    recipient: c.user,
    type: 'admin_announcement',
    title: 'Complaint updated',
    body: `Your complaint is now: ${status}${note ? ' — ' + note : ''}`,
    data: { complaintId: c._id }
  });

  return sendResponse(res, { data: c });
});
