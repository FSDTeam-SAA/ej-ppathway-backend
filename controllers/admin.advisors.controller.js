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
import Favorite from '../models/favorite.model.js';
import { generateLiveKitToken, createRoom } from '../config/livekit.js';
import {
  sendInterviewScheduledEmail,
  sendAdvisorContractEmail,
  sendAdvisorDecisionEmail,
  sendAdvisorStatusUpdateEmail,
  sendAdvisorOnboardingEmail,
  sendAdvisorProfileDecisionEmail,
  sendAdvisorWelcomeEmail
} from '../services/email.service.js';
import { createNotification } from '../services/notification.service.js';
import { getCountryCurrencyCode } from '../services/countryCurrency.service.js';
import { signContractToken } from '../utils/jwt.js';
import { uploadBufferToCloudinary } from '../services/upload.service.js';
import { isWithinSchedule } from '../utils/availability.js';
import { logAdminActivity } from '../services/activity.service.js';

// Notification emails are best-effort: a mail outage (e.g. bad SMTP creds) must
// never roll back or fail the underlying action that already persisted.
const safeEmail = async (label, fn) => {
  try {
    const result = await fn();
    // sendEmail returns { skipped: true } when SMTP isn't configured.
    if (result && result.skipped) return { success: false, skipped: true };
    return { success: true };
  } catch (err) {
    console.error(`[email] ${label} failed:`, err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
};

// Persist the outcome of the latest pipeline notification email on the application
// so the admin dashboard can show whether the advisor was successfully emailed.
const recordNotification = async (app, action, subject, mail) => {
  app.lastNotification = {
    action,
    subject,
    success: !!mail?.success,
    skipped: !!mail?.skipped,
    error: mail?.error || '',
    sentAt: new Date()
  };
  await app.save();
};

const DEFAULT_ADVISOR_DASHBOARD_URL = 'https://ej-ppathway-advisor-dashboard.vercel.app';
const DEFAULT_PUBLIC_SITE_URL = 'https://www.propheticpathway.com';

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const appendPath = (base, path) => {
  const cleanBase = trimTrailingSlash(base);
  if (!path) return cleanBase;
  return `${cleanBase}${path.startsWith('/') ? path : `/${path}`}`;
};

const appendQuery = (url, query, hash = '') => `${url}${url.includes('?') ? '&' : '?'}${query}${hash}`;

const publicSiteBase = () => trimTrailingSlash(
  process.env.PUBLIC_SITE_URL ||
  process.env.WEBSITE_URL ||
  process.env.CLIENT_URL ||
  DEFAULT_PUBLIC_SITE_URL
);

const buildAdvisorLoginUrl = () => {
  if (process.env.ADVISOR_LOGIN_URL) return trimTrailingSlash(process.env.ADVISOR_LOGIN_URL);
  const base = trimTrailingSlash(process.env.ADVISOR_DASHBOARD_URL || DEFAULT_ADVISOR_DASHBOARD_URL);
  return base.endsWith('/login') ? base : `${base}/login`;
};

const buildAdvisorProfileUrl = () => {
  if (process.env.ADVISOR_PROFILE_URL) return trimTrailingSlash(process.env.ADVISOR_PROFILE_URL);
  return appendPath(process.env.ADVISOR_DASHBOARD_URL || DEFAULT_ADVISOR_DASHBOARD_URL, '/profile');
};

const buildInterviewUrl = (applicationId) => {
  const base = process.env.INTERVIEW_URL || process.env.CLIENT_URL || publicSiteBase();
  return appendPath(base, `/advisor/interview/${applicationId}`);
};

const buildContractSigningUrl = (token) => {
  const base = process.env.CONTRACT_SIGN_URL || appendPath(publicSiteBase(), '/contract/sign');
  return appendQuery(trimTrailingSlash(base), `token=${encodeURIComponent(token)}`);
};

const buildOnboardingUrl = (token) => {
  const configured = process.env.ONBOARDING_URL || process.env.Onboarding_url || '';
  const fallbackPath = '/join-as-advisor/apply';
  let base = configured || appendPath(publicSiteBase(), fallbackPath);

  try {
    const parsed = new URL(base, publicSiteBase());
    const isOnboardingRoute =
      parsed.pathname === '/advisor-onboarding' ||
      parsed.pathname === fallbackPath;

    // Some local/prod envs point generic frontend URLs at /login. The email
    // must keep the configured origin, but always open the onboarding route.
    if (!isOnboardingRoute) {
      parsed.pathname = fallbackPath;
      parsed.search = '';
      parsed.hash = '';
    }
    base = parsed.toString().replace(/\/$/, '');
  } catch {
    base = appendPath(publicSiteBase(), fallbackPath);
  }

  const queryName = base.includes('/advisor-onboarding') ? 'token' : 'onboarding';
  const hash = base.includes('/join-as-advisor/apply') ? '#pending-review' : '';
  return appendQuery(trimTrailingSlash(base), `${queryName}=${encodeURIComponent(token)}`, hash);
};

// ====== Approvals ======
export const listApplications = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = {};
  if (req.query.status === 'new') filter.stage = 'application';
  if (req.query.status === 'pending_review') filter.status = 'pending_review';
  if (req.query.status === 'under_review') filter.status = 'under_review';
  if (req.query.status === 'interview_pending') filter.stage = 'pre_recorded_interview';
  if (req.query.status === 'live_interview') {
    filter.stage = 'live_interview';
    filter.status = { $in: ['live_interview', 'scheduled'] };
  }
  if (req.query.status === 'contract') filter.stage = 'contract';
  if (req.query.status === 'approved') filter.status = 'approved';
  if (req.query.status === 'rejected') filter.status = 'rejected';
  if (req.query.q) {
    const q = String(req.query.q).trim();
    const users = await User.find({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ]
    }).select('_id').lean();
    filter.$or = [
      { user: { $in: users.map((u) => u._id) } },
      { professionalTitle: { $regex: q, $options: 'i' } },
      { bio: { $regex: q, $options: 'i' } },
      { expertise: { $regex: q, $options: 'i' } }
    ];
  }

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

  const profile = await AdvisorProfile.findOne({ user: app.user?._id || app.user })
    .lean();

  return sendResponse(res, { data: { ...app, profile: profile || null } });
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
  app.status = 'live_interview';
  await app.save();

  const mail = await safeEmail('interview scheduled', () => sendInterviewScheduledEmail(app.user.email, {
    name: app.user.name,
    datetime: new Date(datetime).toUTCString(),
    joinUrl: buildInterviewUrl(app._id)
  }));
  await recordNotification(app, 'schedule_interview', 'Live Interview Scheduled', mail);

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
    const uploaded = await uploadBufferToCloudinary(req.file.buffer, 'advisor-contracts', 'auto', {
      contentType: req.file.mimetype,
      filename: req.file.originalname
    });
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
  const signingUrl = buildContractSigningUrl(token);

  const mail = await safeEmail('advisor contract', () =>
    sendAdvisorContractEmail(app.user.email, { name: app.user.name, contractUrl: signingUrl })
  );
  await recordNotification(app, 'send_contract', 'Your Advisor Contract', mail);

  await createNotification({
    recipient: app.user._id,
    type: 'admin_announcement',
    title: 'Contract sent',
    body: 'Please review and sign your advisor contract.',
    // Carry the signing token so the dashboard notification can deep-link the
    // logged-in advisor straight to /contract/sign?token=... (same page as email).
    data: { applicationId: app._id, action: 'sign-contract', contractToken: token }
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
        audioMessageUrl: app.audioMessageUrl,
        introVideoUrl: app.introVideoUrl,
        pricing: app.pricing,
        profileReviewStatus: 'approved',
        profileSubmittedAt: new Date(),
        profileReviewedAt: new Date(),
        profileReviewedBy: req.user?._id
      }
    },
    { upsert: true, new: true }
  );

  await User.findByIdAndUpdate(app.user._id, { role: 'advisor', status: 'active', isVerified: true });

  await logAdminActivity({
    adminId: req.user?._id,
    action: 'advisor.approve',
    description: `Approved advisor application for ${app.user.name}`,
    targetType: 'advisor',
    targetUser: app.user._id
  });

  const mail = await safeEmail('advisor approved', () => sendAdvisorDecisionEmail(app.user.email, { name: app.user.name, approved: true }));
  await recordNotification(app, 'approve', 'Advisor Application Approved', mail);
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

  const mail = await safeEmail('advisor rejected', () => sendAdvisorDecisionEmail(app.user.email, { name: app.user.name, approved: false, reason }));
  await recordNotification(app, 'reject', 'Advisor Application Update', mail);
  return sendResponse(res, { message: 'Application rejected', data: app });
});

export const updateApplicationStatus = catchAsync(async (req, res) => {
  const { status } = req.body || {};
  if (!status) throw new ApiError(StatusCodes.BAD_REQUEST, 'status is required');

  const app = await AdvisorApplication.findById(req.params.id).populate('user');
  if (!app) throw new ApiError(StatusCodes.NOT_FOUND, 'Application not found');

  if (status === 'new') {
    app.stage = 'application';
    app.status = 'new';
  } else if (status === 'pending_review') {
    app.stage = 'application';
    app.status = 'pending_review';
  } else if (status === 'live_interview') {
    app.stage = 'live_interview';
    app.status = 'live_interview';
  } else if (status === 'under_review') {
    app.status = 'under_review';
    if (app.stage === 'application') app.stage = 'live_interview';
  } else if (status === 'interview_pending') {
    app.stage = 'pre_recorded_interview';
    app.status = 'scheduled';
  } else {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Unsupported status option');
  }

  await app.save();

  await logAdminActivity({
    adminId: req.user?._id,
    action: 'advisor.application_status',
    description: `Updated advisor application status for ${app.user?.name || 'applicant'} to ${status}`,
    targetType: 'advisor',
    targetUser: app.user?._id
  });

  const mail = await safeEmail('advisor application status', () =>
    sendAdvisorStatusUpdateEmail(app.user?.email, {
      name: app.user?.name,
      status,
      message: status === 'live_interview'
        ? 'A live interview is the next step in your advisor review process.'
        : status === 'under_review'
          ? 'The admin team is reviewing your submitted application.'
          : status === 'pending_review'
            ? 'Your application is waiting for admin review.'
            : 'Please check your advisor dashboard for any next steps.'
    })
  );
  await recordNotification(app, 'application_status', 'Advisor Application Status Updated', mail);

  return sendResponse(res, { message: 'Application status updated', data: app });
});

export const sendOnboarding = catchAsync(async (req, res) => {
  const app = await AdvisorApplication.findById(req.params.id).populate('user');
  if (!app) throw new ApiError(StatusCodes.NOT_FOUND, 'Application not found');
  if (!app.user) throw new ApiError(StatusCodes.BAD_REQUEST, 'This application has no linked user account');

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
        audioMessageUrl: app.audioMessageUrl,
        introVideoUrl: app.introVideoUrl,
        pricing: app.pricing
      },
      $set: {
        profileReviewStatus: 'pending_review',
        profileSubmittedAt: null,
        profileRejectionReason: ''
      }
    },
    { upsert: true, new: true }
  );

  await User.findByIdAndUpdate(app.user._id, {
    role: 'advisor',
    status: 'pending_verification',
    isVerified: true
  });

  const token = signContractToken({
    applicationId: String(app._id),
    type: 'advisor-onboarding'
  });
  const onboardingUrl = buildOnboardingUrl(token);

  const mail = await safeEmail('advisor onboarding', () =>
    sendAdvisorOnboardingEmail(app.user.email, { name: app.user.name, onboardingUrl })
  );
  await recordNotification(app, 'onboarding', 'Complete Your Advisor Profile', mail);
  await createNotification({
    recipient: app.user._id,
    type: 'admin_announcement',
    title: 'Complete advisor onboarding',
    body: 'Please complete your advisor profile for admin review.',
    data: { applicationId: app._id, profileId: profile._id }
  });

  return sendResponse(res, { message: 'Onboarding email sent', data: { app, profile } });
});

export const approveAdvisorProfile = catchAsync(async (req, res) => {
  const app = await AdvisorApplication.findById(req.params.id).populate('user');
  if (!app) throw new ApiError(StatusCodes.NOT_FOUND, 'Application not found');

  const profile = await AdvisorProfile.findOneAndUpdate(
    { user: app.user._id },
    {
      profileReviewStatus: 'approved',
      profileRejectionReason: '',
      profileReviewedAt: new Date(),
      profileReviewedBy: req.user?._id
    },
    { new: true }
  );
  if (!profile) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor profile not found');

  app.status = 'approved';
  await app.save();
  await User.findByIdAndUpdate(app.user._id, { role: 'advisor', status: 'active', isVerified: true });

  const mail = await safeEmail('advisor profile approved', () =>
    sendAdvisorProfileDecisionEmail(app.user.email, {
      name: app.user.name,
      approved: true,
      loginUrl: buildAdvisorLoginUrl()
    })
  );
  await recordNotification(app, 'profile_approve', 'Your Advisor Profile Is Approved', mail);
  await createNotification({
    recipient: app.user._id,
    type: 'admin_announcement',
    title: 'Advisor profile approved',
    body: 'Your profile is now visible to clients.',
    data: { applicationId: app._id }
  });

  return sendResponse(res, { message: 'Advisor profile approved', data: { app, profile } });
});

export const rejectAdvisorProfile = catchAsync(async (req, res) => {
  const { reason } = req.body || {};
  if (!reason || !String(reason).trim()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Rejection notes are required');
  }

  const app = await AdvisorApplication.findById(req.params.id).populate('user');
  if (!app) throw new ApiError(StatusCodes.NOT_FOUND, 'Application not found');

  const profile = await AdvisorProfile.findOneAndUpdate(
    { user: app.user._id },
    {
      profileReviewStatus: 'rejected',
      profileRejectionReason: String(reason).trim(),
      profileReviewedAt: new Date(),
      profileReviewedBy: req.user?._id
    },
    { new: true }
  );
  if (!profile) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor profile not found');

  const mail = await safeEmail('advisor profile rejected', () =>
    sendAdvisorProfileDecisionEmail(app.user.email, {
      name: app.user.name,
      approved: false,
      reason,
      loginUrl: buildAdvisorProfileUrl()
    })
  );
  await recordNotification(app, 'profile_reject', 'Advisor Profile Update Required', mail);
  await createNotification({
    recipient: app.user._id,
    type: 'admin_announcement',
    title: 'Advisor profile needs updates',
    body: String(reason).trim(),
    data: { applicationId: app._id }
  });

  return sendResponse(res, { message: 'Advisor profile rejected', data: { app, profile } });
});

// ====== Advisor management (active advisors) ======
const ADVISOR_TIERS = ['silver', 'gold', 'platinum'];
const normalizeAdvisorTier = (tier) => {
  if (tier === 'bronze') return 'silver';
  return ADVISOR_TIERS.includes(tier) ? tier : null;
};

// Tabs: all | active | deactivated | online | available_now
export const listAdvisors = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const status = req.query.status;
  const filter = { role: 'advisor' };

  // Account-status tabs map straight onto User.status.
  if (['active', 'deactivated', 'pending_verification'].includes(status)) {
    filter.status = status;
  }

  // Presence tabs are driven by the AdvisorProfile (isOnline + schedule), so we
  // first resolve the matching advisor ids and constrain the user query to them.
  if (status === 'online' || status === 'available_now') {
    const onlineProfiles = await AdvisorProfile.find({ isOnline: true })
      .select('user weeklySchedule dateAvailability')
      .lean();
    let matchIds = onlineProfiles.map((p) => p.user);
    if (status === 'available_now') {
      const tzUsers = await User.find({ _id: { $in: matchIds } }).select('timezone').lean();
      const tzMap = new Map(tzUsers.map((u) => [String(u._id), u.timezone]));
      matchIds = onlineProfiles
        .filter((p) => isWithinSchedule(p.weeklySchedule, tzMap.get(String(p.user)), p.dateAvailability))
        .map((p) => p.user);
    }
    filter._id = { $in: matchIds };
  }

  if (['silver', 'gold', 'platinum'].includes(req.query.tier)) {
    const tierProfiles = await AdvisorProfile.find({ tier: req.query.tier }).select('user').lean();
    const tierIds = tierProfiles.map((p) => p.user);
    if (filter._id?.$in) {
      const tierSet = new Set(tierIds.map(String));
      filter._id = { $in: filter._id.$in.filter((id) => tierSet.has(String(id))) };
    } else {
      filter._id = { $in: tierIds };
    }
  }

  if (req.query.q) {
    filter.$and = [
      {
        $or: [
          { name: { $regex: req.query.q, $options: 'i' } },
          { email: { $regex: req.query.q, $options: 'i' } }
        ]
      }
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

  // Per-status counts (kept for backward compatibility) + a single roll-up of the
  // session + financial figures the admin profile page renders.
  const sessionsAgg = await Session.aggregate([
    { $match: { advisor: user._id } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);

  const rollupAgg = await Session.aggregate([
    { $match: { advisor: user._id } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        missed: { $sum: { $cond: [{ $eq: ['$status', 'no_show'] }, 1, 0] } },
        grossRevenue: { $sum: '$chargedAmount' },
        advisorEarnings: { $sum: '$advisorPayout' },
        platformEarnings: { $sum: '$platformCommission' },
        refunds: { $sum: '$refundIssued' },
        tips: { $sum: '$tipAmount' },
        completedDurationSec: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$actualDurationSec', 0] }
        }
      }
    }
  ]);
  const r = rollupAgg[0] || {};

  // Repeat-client / retention rate: share of clients with more than one completed session.
  const repeatAgg = await Session.aggregate([
    { $match: { advisor: user._id, status: 'completed' } },
    { $group: { _id: '$user', c: { $sum: 1 } } },
    {
      $group: {
        _id: null,
        totalClients: { $sum: 1 },
        repeatClients: { $sum: { $cond: [{ $gt: ['$c', 1] }, 1, 0] } }
      }
    }
  ]);
  const rep = repeatAgg[0] || { totalClients: 0, repeatClients: 0 };
  const repeatClientRate = rep.totalClients
    ? Math.round((rep.repeatClients / rep.totalClients) * 100)
    : 0;

  // Payout breakdown straight off the advisor's withdrawal transactions.
  const payoutAgg = await Transaction.aggregate([
    { $match: { advisor: user._id, type: 'advisor_payout' } },
    { $group: { _id: '$withdrawalStatus', amount: { $sum: '$amount' } } }
  ]);
  const payoutByStatus = Object.fromEntries(payoutAgg.map((p) => [p._id || 'unknown', p.amount]));
  const pendingPayouts =
    (payoutByStatus.requested || 0) + (payoutByStatus.approved || 0) || wallet?.pendingPayouts || 0;
  const totalPaidOut = payoutByStatus.paid || wallet?.totalWithdrawn || 0;

  const completed = r.completed || 0;
  const avgSessionMinutes = completed ? Math.round((r.completedDurationSec || 0) / completed / 60) : 0;

  const metrics = {
    sessions: {
      total: r.total || 0,
      completed,
      cancelled: r.cancelled || 0,
      missed: r.missed || 0,
      avgSessionMinutes,
      repeatClientRate,
      retentionRate: repeatClientRate
    },
    finance: {
      totalRevenue: r.grossRevenue || 0,
      advisorEarnings: (r.advisorEarnings || 0) + (r.tips || 0),
      platformEarnings: r.platformEarnings || 0,
      pendingPayouts,
      totalPaidOut,
      refundAmount: r.refunds || 0,
      chargebackAmount: 0
    },
    availability: {
      isOnline: !!profile?.isOnline,
      availableNow: !!profile?.isOnline && isWithinSchedule(profile?.weeklySchedule, user.timezone, profile?.dateAvailability),
      weeklySchedule: profile?.weeklySchedule || null,
      dateAvailability: profile?.dateAvailability || null
    }
  };

  return sendResponse(res, { data: { user, profile, wallet, sessionsAgg, metrics } });
});

export const suspendAdvisor = catchAsync(async (req, res) => {
  const { reason } = req.body;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { status: 'deactivated', suspendedReason: reason || '', suspendedAt: new Date() },
    { new: true }
  );
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor not found');
  await logAdminActivity({
    adminId: req.user?._id,
    action: 'advisor.deactivate',
    description: `Deactivated advisor account ${user.name}`,
    targetType: 'advisor',
    targetUser: user._id
  });
  return sendResponse(res, { message: 'Advisor deactivated', data: user });
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

// Normalise a value that may arrive as an array or a comma-separated string.
const toArray = (v) =>
  Array.isArray(v)
    ? v.map((s) => String(s).trim()).filter(Boolean)
    : v
      ? String(v).split(',').map((s) => s.trim()).filter(Boolean)
      : [];

// Admin edit of an advisor (Edit Profile / Change Tier in the action center).
export const updateAdvisor = catchAsync(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: 'advisor' });
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor not found');

  const {
    name, phoneNumber, country, state, city, timezone,
    professionalTitle, bio, detailedDescription, yearsOfExperience,
    expertise, styles, languages, tier, pricing,
    isOnline, autoOnlineMode, sessionTypes, weeklySchedule, dateAvailability
  } = req.body;

  const userPatch = {};
  if (name !== undefined) userPatch.name = name;
  if (phoneNumber !== undefined) userPatch.phone = phoneNumber;
  if (country !== undefined) {
    const iso2 = String(country).trim().toUpperCase();
    userPatch.country = iso2;
    userPatch.currency = iso2 ? getCountryCurrencyCode(iso2) || user.currency : user.currency;
  }
  if (state !== undefined) userPatch.state = state;
  if (city !== undefined) userPatch.city = city;
  if (timezone !== undefined) userPatch.timezone = timezone;
  if (Object.keys(userPatch).length) await User.findByIdAndUpdate(user._id, userPatch);

  const profPatch = {};
  if (professionalTitle !== undefined) profPatch.professionalTitle = professionalTitle;
  if (bio !== undefined) profPatch.bio = bio;
  if (detailedDescription !== undefined) profPatch.detailedDescription = detailedDescription;
  if (yearsOfExperience !== undefined) profPatch.yearsOfExperience = yearsOfExperience;
  if (expertise !== undefined) profPatch.expertise = toArray(expertise);
  if (styles !== undefined) profPatch.styles = toArray(styles);
  if (languages !== undefined) profPatch.languages = toArray(languages);
  if (isOnline !== undefined) profPatch.isOnline = !!isOnline;
  if (autoOnlineMode !== undefined) profPatch.autoOnlineMode = !!autoOnlineMode;
  if (sessionTypes && typeof sessionTypes === 'object') {
    profPatch.sessionTypes = {
      chat: sessionTypes.chat !== false,
      call: sessionTypes.call !== false,
      video: sessionTypes.video !== false
    };
  }
  if (weeklySchedule && typeof weeklySchedule === 'object') profPatch.weeklySchedule = weeklySchedule;
  if (dateAvailability && typeof dateAvailability === 'object') profPatch.dateAvailability = dateAvailability;
  if (tier !== undefined) {
    const normalizedTier = normalizeAdvisorTier(tier);
    if (!normalizedTier) throw new ApiError(StatusCodes.BAD_REQUEST, 'Tier must be Silver, Gold, or Platinum');
    profPatch.tier = normalizedTier;
  }
  if (pricing && typeof pricing === 'object') {
    if (pricing.chatPerMin !== undefined && pricing.chatPerMin !== '') profPatch['pricing.chatPerMin'] = Number(pricing.chatPerMin);
    if (pricing.callPerMin !== undefined && pricing.callPerMin !== '') profPatch['pricing.callPerMin'] = Number(pricing.callPerMin);
    if (pricing.videoPerMin !== undefined && pricing.videoPerMin !== '') profPatch['pricing.videoPerMin'] = Number(pricing.videoPerMin);
  }

  let profile = await AdvisorProfile.findOne({ user: user._id });
  if (Object.keys(profPatch).length) {
    profile = await AdvisorProfile.findOneAndUpdate({ user: user._id }, profPatch, { new: true, upsert: true });
  }

  const updatedUser = await User.findById(user._id);
  return sendResponse(res, { message: 'Advisor updated', data: { user: updatedUser, profile } });
});

export const addAdvisorManually = catchAsync(async (req, res) => {
  const {
    name, email, phoneNumber, password,
    country, state, city, timezone,
    language, languages, experience,
    type, style, expertise, styles,
    professionalTitle, bio, tier, pricing
  } = req.body;
  if (!name || !email || !password) throw new ApiError(StatusCodes.BAD_REQUEST, 'Missing required fields');

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) throw new ApiError(StatusCodes.CONFLICT, 'Email already registered');

  const iso2 = (country || '').toString().trim().toUpperCase();
  const currency = iso2 ? getCountryCurrencyCode(iso2) || 'USD' : '';

  // Accept the richer profile payload (arrays or comma-separated strings) while
  // staying backward compatible with the old single type/style/language inputs.
  const expertiseArr = expertise != null ? toArray(expertise) : toArray(type);
  const stylesArr = styles != null ? toArray(styles) : toArray(style);
  const languagesArr = toArray(languages != null ? languages : language);

  const user = await User.create({
    name,
    email: email.toLowerCase(),
    phone: phoneNumber,
    password,
    role: 'advisor',
    status: 'active',
    isVerified: true,
    country: iso2,
    state: state || '',
    city: city || '',
    currency,
    timezone: timezone || 'UTC',
    language: languagesArr[0] || 'English'
  });

  const profileData = {
    user: user._id,
    bio: bio || '',
    yearsOfExperience: experience || '',
    expertise: expertiseArr,
    styles: stylesArr,
    languages: languagesArr.length ? languagesArr : ['English'],
    profileReviewStatus: 'approved',
    profileSubmittedAt: new Date(),
    profileReviewedAt: new Date(),
    profileReviewedBy: req.user?._id
  };
  if (professionalTitle) profileData.professionalTitle = professionalTitle;
  if (tier) {
    const normalizedTier = normalizeAdvisorTier(tier);
    if (!normalizedTier) throw new ApiError(StatusCodes.BAD_REQUEST, 'Tier must be Silver, Gold, or Platinum');
    profileData.tier = normalizedTier;
  }
  if (pricing && typeof pricing === 'object') {
    const p = {};
    if (pricing.chatPerMin !== undefined && pricing.chatPerMin !== '') p.chatPerMin = Number(pricing.chatPerMin);
    if (pricing.callPerMin !== undefined && pricing.callPerMin !== '') p.callPerMin = Number(pricing.callPerMin);
    if (pricing.videoPerMin !== undefined && pricing.videoPerMin !== '') p.videoPerMin = Number(pricing.videoPerMin);
    if (Object.keys(p).length) profileData.pricing = p;
  }

  await AdvisorProfile.create(profileData);
  await Wallet.findOneAndUpdate({ user: user._id }, { $setOnInsert: { user: user._id } }, { upsert: true });

  sendAdvisorWelcomeEmail(user.email, {
    name: user.name,
    email: user.email,
    password,
    loginUrl: buildAdvisorLoginUrl()
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

  // Hard delete: the advisor must be fully removed from the system and disappear
  // from the advisor list. We remove the user account and the records that only
  // exist to support it (profile, wallet, application, favorites pointing at them).
  // Historical sessions/transactions keep their ObjectId reference for audit and
  // simply resolve to null on populate — they must never be silently destroyed.
  await Promise.all([
    AdvisorProfile.deleteOne({ user: user._id }),
    Wallet.deleteOne({ user: user._id }),
    AdvisorApplication.deleteMany({ user: user._id }),
    Favorite.deleteMany({ $or: [{ advisor: user._id }, { user: user._id }] })
  ]);
  await User.deleteOne({ _id: user._id });

  await logAdminActivity({
    adminId: req.user?._id,
    action: 'advisor.delete',
    description: `Deleted advisor account ${user.name}`,
    targetType: 'advisor'
  });

  return sendResponse(res, { message: 'Advisor deleted' });
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
