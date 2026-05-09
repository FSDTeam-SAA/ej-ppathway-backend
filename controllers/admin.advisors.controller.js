import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import bcrypt from 'bcryptjs';
import User from '../models/user.model.js';
import AdvisorApplication from '../models/advisorApplication.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import Wallet from '../models/wallet.model.js';
import Session from '../models/session.model.js';
import Transaction from '../models/transaction.model.js';
import { generateLiveKitToken, createRoom } from '../config/livekit.js';
import {
  sendInterviewScheduledEmail,
  sendAdvisorContractEmail,
  sendAdvisorDecisionEmail
} from '../services/email.service.js';
import { createNotification } from '../services/notification.service.js';

// ====== Approvals ======
export const listApplications = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = {};
  if (req.query.status === 'new') filter.stage = 'application';
  if (req.query.status === 'under_review') filter.status = 'under_review';
  if (req.query.status === 'interview_pending') filter.stage = 'pre_recorded_interview';
  if (req.query.status === 'live_interview') filter.stage = 'live_interview';
  if (req.query.status === 'contract') filter.stage = 'contract';
  if (req.query.status === 'approved') filter.status = 'approved';
  if (req.query.status === 'rejected') filter.status = 'rejected';

  const total = await AdvisorApplication.countDocuments(filter);
  const apps = await AdvisorApplication.find(filter)
    .populate('user', 'name email profilePhoto location createdAt')
    .sort({ createdAt: -1 }).skip(skip).limit(limit).lean();

  return sendResponse(res, { data: apps, meta: buildMeta({ page, limit, total }) });
});

export const getApplication = catchAsync(async (req, res) => {
  const app = await AdvisorApplication.findById(req.params.id)
    .populate('user', 'name email profilePhoto location createdAt');
  if (!app) throw new ApiError(StatusCodes.NOT_FOUND, 'Application not found');
  return sendResponse(res, { data: app });
});

export const scheduleLiveInterview = catchAsync(async (req, res) => {
  const { datetime } = req.body;
  if (!datetime) throw new ApiError(StatusCodes.BAD_REQUEST, 'datetime required');

  const app = await AdvisorApplication.findById(req.params.id).populate('user');
  if (!app) throw new ApiError(StatusCodes.NOT_FOUND, 'Application not found');

  const roomName = `interview_${app._id}`;
  await createRoom(roomName, { maxParticipants: 4, metadata: { applicationId: String(app._id) } });

  app.liveInterview = {
    scheduledAt: new Date(datetime),
    roomName,
    notes: app.liveInterview?.notes
  };
  app.stage = 'live_interview';
  app.status = 'scheduled';
  await app.save();

  await sendInterviewScheduledEmail(app.user.email, {
    name: app.user.name,
    datetime: new Date(datetime).toUTCString(),
    joinUrl: `${process.env.CLIENT_URL || ''}/advisor/interview/${app._id}`
  });

  await createNotification({
    recipient: app.user._id,
    type: 'admin_announcement',
    title: 'Interview scheduled',
    body: `Your live interview is on ${new Date(datetime).toLocaleString()}`,
    data: { applicationId: app._id }
  });

  return sendResponse(res, { message: 'Interview scheduled', data: app });
});

export const interviewToken = catchAsync(async (req, res) => {
  const app = await AdvisorApplication.findById(req.params.id).populate('user');
  if (!app || !app.liveInterview?.roomName) throw new ApiError(StatusCodes.NOT_FOUND, 'No interview scheduled');
  const isAdmin = req.user.role === 'admin' || req.user.role === 'sub_admin';
  const isApplicant = String(app.user._id) === String(req.user._id);
  if (!isAdmin && !isApplicant) throw new ApiError(StatusCodes.FORBIDDEN, 'Forbidden');

  const { token, url } = await generateLiveKitToken({
    identity: String(req.user._id),
    name: req.user.name,
    roomName: app.liveInterview.roomName,
    metadata: { role: isAdmin ? 'admin' : 'applicant' }
  });
  return sendResponse(res, { data: { token, url, roomName: app.liveInterview.roomName } });
});

export const sendContract = catchAsync(async (req, res) => {
  const { contractUrl } = req.body;
  const app = await AdvisorApplication.findById(req.params.id).populate('user');
  if (!app) throw new ApiError(StatusCodes.NOT_FOUND, 'Application not found');

  app.contract = { sentAt: new Date(), url: contractUrl };
  app.stage = 'contract';
  app.status = 'awaiting_signature';
  await app.save();

  await sendAdvisorContractEmail(app.user.email, { name: app.user.name, contractUrl });

  await createNotification({
    recipient: app.user._id,
    type: 'admin_announcement',
    title: 'Contract sent',
    body: 'Please sign your advisor contract.',
    data: { applicationId: app._id }
  });

  return sendResponse(res, { message: 'Contract sent', data: app });
});

export const approveApplication = catchAsync(async (req, res) => {
  const app = await AdvisorApplication.findById(req.params.id).populate('user');
  if (!app) throw new ApiError(StatusCodes.NOT_FOUND, 'Application not found');

  app.status = 'approved';
  await app.save();

  // ensure advisor profile exists with their submitted data
  const profile = await AdvisorProfile.findOneAndUpdate(
    { user: app.user._id },
    {
      $set: {
        professionalTitle: app.professionalTitle,
        bio: app.bio,
        detailedDescription: app.detailedDescription,
        yearsOfExperience: app.yearsOfExperience,
        expertise: app.expertise,
        styles: app.styles,
        languages: app.languages,
        introVideoUrl: app.introVideoUrl,
        pricing: app.pricing
      },
      $setOnInsert: { user: app.user._id }
    },
    { upsert: true, new: true }
  );

  await User.findByIdAndUpdate(app.user._id, { role: 'advisor', status: 'active', isVerified: true });

  await sendAdvisorDecisionEmail(app.user.email, { name: app.user.name, approved: true });
  await createNotification({
    recipient: app.user._id,
    type: 'admin_announcement',
    title: 'Application approved 🎉',
    body: 'Welcome aboard! You can now start advising.',
    data: { applicationId: app._id }
  });

  return sendResponse(res, { message: 'Advisor approved', data: { app, profile } });
});

export const rejectApplication = catchAsync(async (req, res) => {
  const { reason } = req.body;
  const app = await AdvisorApplication.findById(req.params.id).populate('user');
  if (!app) throw new ApiError(StatusCodes.NOT_FOUND, 'Application not found');

  app.status = 'rejected';
  app.rejectionReason = reason || '';
  await app.save();

  await sendAdvisorDecisionEmail(app.user.email, { name: app.user.name, approved: false, reason });
  return sendResponse(res, { message: 'Application rejected', data: app });
});

// ====== Advisor management (active advisors) ======
export const listAdvisors = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { role: 'advisor' };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) {
    filter.$or = [
      { name: { $regex: req.query.q, $options: 'i' } },
      { email: { $regex: req.query.q, $options: 'i' } }
    ];
  }

  const total = await User.countDocuments(filter);
  const users = await User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
  const ids = users.map((u) => u._id);
  const profiles = await AdvisorProfile.find({ user: { $in: ids } }).lean();
  const map = new Map(profiles.map((p) => [String(p.user), p]));

  const data = users.map((u) => ({ user: u, profile: map.get(String(u._id)) || null }));
  return sendResponse(res, { data, meta: buildMeta({ page, limit, total }) });
});

export const getAdvisor = catchAsync(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: 'advisor' });
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor not found');
  const profile = await AdvisorProfile.findOne({ user: user._id });
  const wallet = await Wallet.findOne({ user: user._id });
  const sessionsAgg = await Session.aggregate([
    { $match: { advisor: user._id } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);
  return sendResponse(res, { data: { user, profile, wallet, sessionsAgg } });
});

export const suspendAdvisor = catchAsync(async (req, res) => {
  const { reason } = req.body;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { status: 'suspended', suspendedReason: reason || '', suspendedAt: new Date() },
    { new: true }
  );
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor not found');
  return sendResponse(res, { message: 'Advisor suspended', data: user });
});

export const unsuspendAdvisor = catchAsync(async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { status: 'active', suspendedReason: null, suspendedAt: null },
    { new: true }
  );
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor not found');
  return sendResponse(res, { message: 'Advisor reactivated', data: user });
});

export const addAdvisorManually = catchAsync(async (req, res) => {
  const {
    name, email, phoneNumber, password,
    location, language, experience, type, style, bio
  } = req.body;
  if (!name || !email || !password) throw new ApiError(StatusCodes.BAD_REQUEST, 'Missing required fields');

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) throw new ApiError(StatusCodes.CONFLICT, 'Email already registered');

  const user = await User.create({
    name,
    email: email.toLowerCase(),
    phone: phoneNumber,
    password,
    role: 'advisor',
    status: 'active',
    isVerified: true,
    location,
    language: language || 'English'
  });

  await AdvisorProfile.create({
    user: user._id,
    bio: bio || '',
    yearsOfExperience: experience || '',
    expertise: type ? [type] : [],
    styles: style ? [style] : []
  });
  await Wallet.findOneAndUpdate({ user: user._id }, { $setOnInsert: { user: user._id } }, { upsert: true });

  return sendResponse(res, { statusCode: StatusCodes.CREATED, message: 'Advisor created', data: user });
});
