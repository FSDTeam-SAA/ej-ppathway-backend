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
import User from '../models/user.model.js';
import Dispute from '../models/dispute.model.js';
import Session from '../models/session.model.js';

const dateFilterFromQuery = (query) => {
  const range = {};
  const now = new Date();
  if (query.period === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    range.$gte = start;
  } else if (query.period === 'week') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    range.$gte = start;
  } else if (query.period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    range.$gte = start;
  } else if (query.from || query.to) {
    if (query.from) {
      const from = new Date(query.from);
      if (!Number.isNaN(from.getTime())) range.$gte = from;
    }
    if (query.to) {
      const to = new Date(query.to);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        range.$lte = to;
      }
    }
  }
  return Object.keys(range).length ? range : null;
};

const uploadDocs = async (files) => {
  if (!files || !files.length) return [];
  const urls = [];
  for (const f of files) {
    const r = await uploadBufferToCloudinary(f.buffer, 'complaint-docs', 'auto', {
      contentType: f.mimetype,
      filename: f.originalname
    });
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
  if (req.query.q) {
    const q = String(req.query.q).trim();
    const users = await User.find({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ]
    }).select('_id').lean();
    filter.$or = [
      { issueType: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
      { user: { $in: users.map((u) => u._id) } },
      { advisor: { $in: users.map((u) => u._id) } }
    ];
  }
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
  const createdAt = dateFilterFromQuery(req.query);
  if (createdAt) filter.createdAt = createdAt;
  if (req.query.status) {
    if (!COMPLAINT_STATUSES.includes(req.query.status)) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid status');
    filter.status = req.query.status;
  }
  if (req.query.kind) filter.kind = req.query.kind;
  if (req.query.q) {
    const q = String(req.query.q).trim();
    const users = await User.find({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ]
    }).select('_id').lean();
    filter.$or = [
      { issueType: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
      { user: { $in: users.map((u) => u._id) } },
      { advisor: { $in: users.map((u) => u._id) } }
    ];
  }

  const total = await Complaint.countDocuments(filter);
  const items = await Complaint.find(filter)
    .populate('user', 'name email profilePhoto')
    .populate('advisor', 'name email profilePhoto')
    .populate('resolvedBy', 'name email')
    .populate('session', 'sessionCode type chargedAmount actualDurationSec durationMinutes scheduledFor startedAt endedAt recordingUrl transcriptUrl status')
    .sort({ createdAt: -1 }).skip(skip).limit(limit).lean();

  const statsFilter = createdAt ? { createdAt } : {};
  const [total_, open, solved, rejected, totalDisputes, openDisputes, resolvedDisputes, flaggedUsers, flaggedAdvisors] = await Promise.all([
    Complaint.countDocuments(statsFilter),
    Complaint.countDocuments({ ...statsFilter, status: { $in: ['pending', 'reviewing'] } }),
    Complaint.countDocuments({ ...statsFilter, status: 'complete' }),
    Complaint.countDocuments({ ...statsFilter, status: 'reject' }),
    Dispute.countDocuments(statsFilter),
    Dispute.countDocuments({ ...statsFilter, status: { $in: ['open', 'investigating'] } }),
    Dispute.countDocuments({ ...statsFilter, status: 'resolved' }),
    Session.distinct('user', { status: 'flagged', ...(createdAt ? { createdAt } : {}) }).then((ids) => ids.length),
    Session.distinct('advisor', { status: 'flagged', ...(createdAt ? { createdAt } : {}) }).then((ids) => ids.length)
  ]);

  return sendResponse(res, {
    data: items,
    meta: {
      ...buildMeta({ page, limit, total }),
      totals: {
        all: total_,
        open,
        solved,
        rejected,
        totalDisputes,
        openDisputes,
        resolvedDisputes,
        flaggedUsers,
        flaggedAdvisors
      }
    }
  });
});

export const adminDeleteComplaint = catchAsync(async (req, res) => {
  const c = await Complaint.findByIdAndDelete(req.params.id);
  if (!c) throw new ApiError(StatusCodes.NOT_FOUND, 'Complaint not found');
  return sendResponse(res, { message: 'Complaint deleted' });
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
