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
  sendAdvisorDecisionEmail,
  sendAdvisorWelcomeEmail
} from '../services/email.service.js';
import { createNotification } from '../services/notification.service.js';
import { getCountryCurrencyCode } from '../services/countryCurrency.service.js';
import { signContractToken } from '../utils/jwt.js';
import { uploadBufferToCloudinary } from '../services/upload.service.js';

// Notification emails are best-effort: a mail outage (e.g. bad SMTP creds) must
// never roll back or fail the underlying action that already persisted.
const safeEmail = async (label, fn) => {
  try {
    await fn();
  } catch (err) {
    console.error(`[email] ${label} failed:`, err?.message || err);
  }
};

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
    .populate('user', 'name email profilePhoto country city createdAt')
    .sort({ createdAt: -1 }).skip(skip).limit(limit).lean();

  return sendResponse(res, { data: apps, meta: buildMeta({ page, limit, total }) });
});

export const getApplication = catchAsync(async (req, res) => {
  const app = await AdvisorApplication.findById(req.params.id)
    .populate('user', 'name email profilePhoto country city currency createdAt')
    .lean();
  if (!app) throw new ApiError(StatusCodes.NOT_FOUND, 'Application not found');

  // The application only holds an apply-time snapshot. The advisor's *current*
  // pricing, expertise, intro video, etc. live on their AdvisorProfile (edited
  // from the advisor dashboard), and their address now lives on the User. Merge
  // those in so the admin always sees the advisor's real, up-to-date data.
  const profile = app.user?._id
    ? await AdvisorProfile.findOne({ user: app.user._id }).lean()
    : null;

  if (profile) {
    app.pricing = profile.pricing || app.pricing;
    if (profile.expertise?.length) app.expertise = profile.expertise;
    if (profile.styles?.length) app.styles = profile.styles;
    if (profile.languages?.length) app.languages = profile.languages;
    app.professionalTitle = profile.professionalTitle || app.professionalTitle;
    app.bio = profile.bio || app.bio;
    app.detailedDescription = profile.detailedDescription || app.detailedDescription;
    app.yearsOfExperience = profile.yearsOfExperience || app.yearsOfExperience;
    app.introVideoUrl = app.introVideoUrl || profile.introVideoUrl;
  }

  // Address now lives on the User (country + city dropdowns); fall back to it.
  app.applicantDetails = {
    ...(app.applicantDetails || {}),
    country: app.applicantDetails?.country || app.user?.country || '',
    city: app.applicantDetails?.city || app.user?.city || ''
  };

  return sendResponse(res, { data: app });
});

export const scheduleLiveInterview = catchAsync(async (req, res) => {
  const { datetime } = req.body;
  if (!datetime) throw new ApiError(StatusCodes.BAD_REQUEST, 'datetime required');

  const app = await AdvisorApplication.findById(req.params.id).populate('user');
  if (!app) throw new ApiError(StatusCodes.NOT_FOUND, 'Application not found');

  const roomName = `interview_${app._id}`;
  // Best-effort: the room is auto-created when the first participant joins, so a
  // provisioning hiccup (or missing/invalid LiveKit creds) must not block scheduling.
  try {
    await createRoom(roomName, { maxParticipants: 4, metadata: { applicationId: String(app._id) } });
  } catch (err) {
    console.error('[livekit] room pre-create failed (will auto-create on join):', err?.message || err);
  }

  app.liveInterview = {
    scheduledAt: new Date(datetime),
    roomName,
    notes: app.liveInterview?.notes
  };
  app.stage = 'live_interview';
  app.status = 'scheduled';
  await app.save();

  await safeEmail('interview scheduled', () => sendInterviewScheduledEmail(app.user.email, {
    name: app.user.name,
    datetime: new Date(datetime).toUTCString(),
    joinUrl: `${process.env.CLIENT_URL || ''}/advisor/interview/${app._id}`
  }));

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
  const app = await AdvisorApplication.findById(req.params.id).populate('user');
  if (!app) throw new ApiError(StatusCodes.NOT_FOUND, 'Application not found');
  if (!app.user) throw new ApiError(StatusCodes.BAD_REQUEST, 'This application has no linked user account');

  // Admin can either upload a contract PDF (preferred) or paste an external URL.
  let contractUrl = req.body.contractUrl;
  if (req.file) {
    const uploaded = await uploadBufferToCloudinary(req.file.buffer, 'advisor-contracts', 'auto');
    contractUrl = uploaded.secure_url;
  }
  if (!contractUrl) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Upload a contract PDF or provide a contract URL');
  }

  // Reset the contract block on (re)send so any prior signature is cleared.
  app.contract = { sentAt: new Date(), url: contractUrl };
  app.stage = 'contract';
  app.status = 'awaiting_signature';
  await app.save();

  // Tokenized signing link to the public signing page (applicant isn't logged in).
  // NOTE: deliberately NO `sub` claim — that prevents this long-lived, emailed
  // token from being reused as a Bearer access token (the auth middleware
  // authenticates by `decoded.sub`, which is absent here).
  const token = signContractToken({
    contractId: String(app._id),
    type: 'contract-sign'
  });
  const signingUrl = `${process.env.CLIENT_URL || ''}/contract/sign?token=${token}`;

  await safeEmail('advisor contract', () =>
    sendAdvisorContractEmail(app.user.email, { name: app.user.name, contractUrl: signingUrl })
  );

  await createNotification({
    recipient: app.user._id,
    type: 'admin_announcement',
    title: 'Contract sent',
    body: 'Please review and sign your advisor contract.',
    data: { applicationId: app._id }
  });

  return sendResponse(res, { message: 'Contract sent', data: app });
});

export const approveApplication = catchAsync(async (req, res) => {
  const app = await AdvisorApplication.findById(req.params.id).populate('user');
  if (!app) throw new ApiError(StatusCodes.NOT_FOUND, 'Application not found');

  app.status = 'approved';
  await app.save();

  // Ensure an advisor profile exists, seeded from the application's submitted
  // data — but ONLY on first creation. If the advisor already has a profile
  // (e.g. they edited their pricing/expertise from the dashboard before
  // approval), those live values must NOT be clobbered by the apply-time
  // snapshot. Hence $setOnInsert, not $set.
  const profile = await AdvisorProfile.findOneAndUpdate(
    { user: app.user._id },
    {
      $setOnInsert: {
        user: app.user._id,
        professionalTitle: app.professionalTitle,
        bio: app.bio,
        detailedDescription: app.detailedDescription,
        yearsOfExperience: app.yearsOfExperience,
        expertise: app.expertise,
        styles: app.styles,
        languages: app.languages,
        introVideoUrl: app.introVideoUrl,
        pricing: app.pricing
      }
    },
    { upsert: true, new: true }
  );

  await User.findByIdAndUpdate(app.user._id, { role: 'advisor', status: 'active', isVerified: true });

  await safeEmail('advisor approved', () => sendAdvisorDecisionEmail(app.user.email, { name: app.user.name, approved: true }));
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

  await safeEmail('advisor rejected', () => sendAdvisorDecisionEmail(app.user.email, { name: app.user.name, approved: false, reason }));
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
    country, city, language, experience, type, style, bio
  } = req.body;
  if (!name || !email || !password) throw new ApiError(StatusCodes.BAD_REQUEST, 'Missing required fields');

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) throw new ApiError(StatusCodes.CONFLICT, 'Email already registered');

  const iso2 = (country || '').toString().trim().toUpperCase();
  const currency = iso2 ? getCountryCurrencyCode(iso2) || 'USD' : '';

  const user = await User.create({
    name,
    email: email.toLowerCase(),
    phone: phoneNumber,
    password,
    role: 'advisor',
    status: 'active',
    isVerified: true,
    country: iso2,
    city: city || '',
    currency,
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

  sendAdvisorWelcomeEmail(user.email, {
    name: user.name,
    email: user.email,
    password,
    loginUrl: `${process.env.ADVISOR_DASHBOARD_URL || ''}/login`
  }).catch((err) => console.error(`[email] Failed to send welcome email to ${user.email}:`, err.message));

  return sendResponse(res, { statusCode: StatusCodes.CREATED, message: 'Advisor created', data: user });
});

export const deleteApplication = catchAsync(async (req, res) => {
  const app = await AdvisorApplication.findByIdAndDelete(req.params.id);
  if (!app) throw new ApiError(StatusCodes.NOT_FOUND, 'Application not found');
  return sendResponse(res, { message: 'Application deleted' });
});

export const deleteAdvisor = catchAsync(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: 'advisor' });
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor not found');
  user.status = 'deactivated';
  await user.save();
  return sendResponse(res, { message: 'Advisor deactivated' });
});

export const setAdvisorFeaturedOnHome = catchAsync(async (req, res) => {
  const isFeaturedOnHome = !!req.body?.isFeaturedOnHome;
  const profile = await AdvisorProfile.findOneAndUpdate(
    { user: req.params.id },
    { isFeaturedOnHome },
    { new: true }
  );
  if (!profile) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor profile not found');
  return sendResponse(res, { data: profile, message: 'Featured flag updated' });
});
