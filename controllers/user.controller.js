import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { uploadBufferToCloudinary } from '../services/upload.service.js';
import { getCountryCurrencyCode } from '../services/countryCurrency.service.js';
import User from '../models/user.model.js';
import Favorite from '../models/favorite.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import {
  ONBOARDING_STEPS,
  ONBOARDING_TOTAL_STEPS,
  SEEKING_HELP_WITH,
  GUIDANCE_TYPES,
  CONNECTION_METHODS,
  ATMOSPHERES,
  GUIDANCE_FREQUENCIES,
  TAILORED_AREAS,
  GUIDE_QUALITY_PRIORITIES
} from '../utils/onboardingOptions.js';

// ===== Profile =====
export const getProfile = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  return sendResponse(res, { data: user });
});

export const updateProfile = catchAsync(async (req, res) => {
  const allowed = ['name', 'phone', 'city', 'country', 'currency', 'timezone', 'language', 'profilePhoto'];
  const update = {};
  for (const key of allowed) {
    if (typeof req.body[key] !== 'undefined') update[key] = req.body[key];
  }

  // Keep the displayed currency in sync with the selected country (the country's
  // own default currency, so the right symbol shows everywhere).
  if (typeof update.country !== 'undefined') {
    update.country = (update.country || '').toString().trim().toUpperCase();
    if (typeof req.body.currency === 'undefined') {
      update.currency = update.country
        ? getCountryCurrencyCode(update.country) || 'USD'
        : '';
    }
  }

  if (req.file) {
    const result = await uploadBufferToCloudinary(req.file.buffer, 'profile-photos', 'image');
    update.profilePhoto = result.secure_url;
  }

  const user = await User.findByIdAndUpdate(req.user._id, update, { new: true });
  return sendResponse(res, { message: 'Profile updated', data: user });
});

export const updateNotificationPrefs = catchAsync(async (req, res) => {
  const prefs = ['email', 'newSessions', 'newMessages', 'paymentUpdates', 'push'];
  const update = {};
  for (const k of prefs) {
    if (typeof req.body[k] === 'boolean') update[`notifPrefs.${k}`] = req.body[k];
  }
  const user = await User.findByIdAndUpdate(req.user._id, update, { new: true });
  return sendResponse(res, { message: 'Preferences updated', data: user.notifPrefs });
});

export const registerFcmToken = catchAsync(async (req, res) => {
  const { token } = req.body;
  if (!token) throw new ApiError(StatusCodes.BAD_REQUEST, 'token required');
  await User.findByIdAndUpdate(req.user._id, { $addToSet: { fcmTokens: token } });
  return sendResponse(res, { message: 'Token registered' });
});

export const removeFcmToken = catchAsync(async (req, res) => {
  const { token } = req.body;
  await User.findByIdAndUpdate(req.user._id, { $pull: { fcmTokens: token } });
  return sendResponse(res, { message: 'Token removed' });
});

export const deactivateAccount = catchAsync(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { status: 'deactivated' });
  return sendResponse(res, { message: 'Account deactivated' });
});

// ===== Onboarding / Preferences =====
const ALLOWED = {
  seekingHelpWith: new Set(SEEKING_HELP_WITH),
  guidanceType: new Set(GUIDANCE_TYPES),
  connectionMethods: new Set(CONNECTION_METHODS),
  atmosphere: new Set(ATMOSPHERES),
  guidanceFrequency: new Set(GUIDANCE_FREQUENCIES),
  tailoredAreas: new Set(TAILORED_AREAS),
  guideQualityPriority: new Set(GUIDE_QUALITY_PRIORITIES)
};

const validateArray = (field, value) => {
  if (!Array.isArray(value)) throw new ApiError(StatusCodes.BAD_REQUEST, `${field} must be an array`);
  const allowed = ALLOWED[field];
  for (const v of value) {
    if (!allowed.has(v)) throw new ApiError(StatusCodes.BAD_REQUEST, `${field} contains invalid value: ${v}`);
  }
};

const validateSingle = (field, value) => {
  if (typeof value !== 'string') throw new ApiError(StatusCodes.BAD_REQUEST, `${field} must be a string`);
  if (!ALLOWED[field].has(value)) throw new ApiError(StatusCodes.BAD_REQUEST, `${field} is not a valid option`);
};

export const getOnboardingQuestions = catchAsync(async (_req, res) => {
  return sendResponse(res, {
    data: { totalSteps: ONBOARDING_TOTAL_STEPS, steps: ONBOARDING_STEPS }
  });
});

export const getPreferences = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id).lean();
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  return sendResponse(res, {
    data: { preferences: user.preferences || {}, onboardingCompleted: !!user.onboardingCompleted }
  });
});

// Each step's "is answered" predicate, in step order.
const STEP_ANSWERED = [
  (p) => Array.isArray(p.seekingHelpWith) && p.seekingHelpWith.length > 0,
  (p) => !!p.guidanceType,
  (p) => Array.isArray(p.connectionMethods) && p.connectionMethods.length > 0,
  (p) => !!p.atmosphere,
  (p) => !!p.guidanceFrequency,
  (p) => Array.isArray(p.tailoredAreas) && p.tailoredAreas.length > 0,
  (p) => !!p.guideQualityPriority,
  (p) => typeof p.usedPlatformBefore === 'boolean'
];

const detectDevice = (req) => {
  const explicit = (req.body?.device || req.get('x-onboarding-device') || '').toLowerCase();
  if (['mobile_app', 'mobile_web', 'desktop'].includes(explicit)) return explicit;
  const ua = (req.get('user-agent') || '').toLowerCase();
  if (!ua) return null;
  // Native app should send X-Onboarding-Device: mobile_app explicitly.
  if (/mobile|android|iphone|ipad|ipod/.test(ua)) return 'mobile_web';
  return 'desktop';
};

export const submitPreferences = catchAsync(async (req, res) => {
  const {
    seekingHelpWith,
    guidanceType,
    connectionMethods,
    atmosphere,
    guidanceFrequency,
    tailoredAreas,
    guideQualityPriority,
    usedPlatformBefore
  } = req.body;

  const incoming = {};

  if (typeof seekingHelpWith !== 'undefined') {
    validateArray('seekingHelpWith', seekingHelpWith);
    incoming.seekingHelpWith = seekingHelpWith;
  }
  if (typeof guidanceType !== 'undefined') {
    validateSingle('guidanceType', guidanceType);
    incoming.guidanceType = guidanceType;
  }
  if (typeof connectionMethods !== 'undefined') {
    validateArray('connectionMethods', connectionMethods);
    incoming.connectionMethods = connectionMethods;
  }
  if (typeof atmosphere !== 'undefined') {
    validateSingle('atmosphere', atmosphere);
    incoming.atmosphere = atmosphere;
  }
  if (typeof guidanceFrequency !== 'undefined') {
    validateSingle('guidanceFrequency', guidanceFrequency);
    incoming.guidanceFrequency = guidanceFrequency;
  }
  if (typeof tailoredAreas !== 'undefined') {
    validateArray('tailoredAreas', tailoredAreas);
    incoming.tailoredAreas = tailoredAreas;
  }
  if (typeof guideQualityPriority !== 'undefined') {
    validateSingle('guideQualityPriority', guideQualityPriority);
    incoming.guideQualityPriority = guideQualityPriority;
  }
  if (typeof usedPlatformBefore !== 'undefined') {
    if (typeof usedPlatformBefore !== 'boolean') {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'usedPlatformBefore must be boolean');
    }
    incoming.usedPlatformBefore = usedPlatformBefore;
  }

  // Merge with existing answers so partial submissions (per-step) work too.
  const existing = await User.findById(req.user._id).lean();
  if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');

  const before = existing.preferences || {};
  const merged = { ...before, ...incoming };

  const now = new Date();
  const onboarding = existing.onboarding || {};
  const stepCompletedAt = { ...(onboarding.stepCompletedAt || {}) };

  // Stamp the first time each step transitions from unanswered to answered.
  let highestNewlyCompleted = onboarding.lastStep || 0;
  for (let i = 0; i < STEP_ANSWERED.length; i++) {
    const stepNum = i + 1;
    const key = `s${stepNum}`;
    const wasAnswered = STEP_ANSWERED[i](before);
    const isAnswered = STEP_ANSWERED[i](merged);
    if (!wasAnswered && isAnswered) {
      stepCompletedAt[key] = now;
      if (stepNum > highestNewlyCompleted) highestNewlyCompleted = stepNum;
    }
  }

  const completed = STEP_ANSWERED.every((fn) => fn(merged));
  if (completed) merged.completedAt = merged.completedAt || now;

  const update = {
    preferences: merged,
    onboardingCompleted: completed,
    'onboarding.lastStep': highestNewlyCompleted,
    'onboarding.stepCompletedAt': stepCompletedAt
  };

  if (!onboarding.startedAt) update['onboarding.startedAt'] = now;
  if (!onboarding.device) {
    const dev = detectDevice(req);
    if (dev) update['onboarding.device'] = dev;
  }
  if (completed && !onboarding.completedAt) update['onboarding.completedAt'] = now;

  const user = await User.findByIdAndUpdate(req.user._id, update, { new: true });

  return sendResponse(res, {
    message: completed ? 'Onboarding complete' : 'Preferences saved',
    data: { preferences: user.preferences, onboardingCompleted: user.onboardingCompleted }
  });
});

// Marks that the user opened the onboarding flow. Idempotent: only sets values
// the first time. Useful for measuring "Onboarding Started" independently of
// step submissions.
export const startOnboarding = catchAsync(async (req, res) => {
  const existing = await User.findById(req.user._id).lean();
  if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');

  const update = {};
  if (!existing.onboarding?.startedAt) update['onboarding.startedAt'] = new Date();
  if (!existing.onboarding?.device) {
    const dev = detectDevice(req);
    if (dev) update['onboarding.device'] = dev;
  }

  if (Object.keys(update).length) {
    await User.updateOne({ _id: req.user._id }, update);
  }
  return sendResponse(res, { message: 'Onboarding started' });
});

const PAYWALL_ACTIONS = ['wallet_selected', 'subscription_selected', 'payment_completed', 'abandoned'];

// Records the user's interaction with the paywall shown after onboarding.
// - `reached: true` (without action) → user just landed on the paywall.
// - `action` → records a terminal choice. `payment_completed` also marks
//   wallet/subscription steps as implicitly fulfilled.
export const trackPaywall = catchAsync(async (req, res) => {
  const { reached, action } = req.body || {};

  const existing = await User.findById(req.user._id).lean();
  if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');

  const update = {};
  const now = new Date();

  if (reached && !existing.onboarding?.paywall?.reachedAt) {
    update['onboarding.paywall.reachedAt'] = now;
  }

  if (typeof action !== 'undefined') {
    if (!PAYWALL_ACTIONS.includes(action)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, `action must be one of ${PAYWALL_ACTIONS.join(', ')}`);
    }
    // Only let the action upgrade towards completion — don't overwrite a paid user
    // with `abandoned` if they come back later.
    const current = existing.onboarding?.paywall?.action;
    const RANK = { abandoned: 0, wallet_selected: 1, subscription_selected: 2, payment_completed: 3 };
    if (!current || (RANK[action] ?? -1) > (RANK[current] ?? -1)) {
      update['onboarding.paywall.action'] = action;
      update['onboarding.paywall.actionAt'] = now;
    }
    if (!existing.onboarding?.paywall?.reachedAt) {
      update['onboarding.paywall.reachedAt'] = now;
    }
  }

  if (Object.keys(update).length) {
    await User.updateOne({ _id: req.user._id }, update);
  }
  return sendResponse(res, { message: 'Paywall event recorded' });
});

// ===== Favorites =====
export const addFavorite = catchAsync(async (req, res) => {
  const { advisorId } = req.params;
  const advisor = await User.findOne({ _id: advisorId, role: 'advisor' });
  if (!advisor) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor not found');
  await Favorite.findOneAndUpdate(
    { user: req.user._id, advisor: advisorId },
    { $setOnInsert: { user: req.user._id, advisor: advisorId } },
    { upsert: true, new: true }
  );
  return sendResponse(res, { message: 'Added to favorites' });
});

export const removeFavorite = catchAsync(async (req, res) => {
  const { advisorId } = req.params;
  await Favorite.findOneAndDelete({ user: req.user._id, advisor: advisorId });
  return sendResponse(res, { message: 'Removed from favorites' });
});

export const listFavorites = catchAsync(async (req, res) => {
  const favs = await Favorite.find({ user: req.user._id }).sort({ createdAt: -1 });
  const advisorIds = favs.map((f) => f.advisor);
  const advisors = await User.find({ _id: { $in: advisorIds } });
  const profiles = await AdvisorProfile.find({ user: { $in: advisorIds } });
  const map = new Map(profiles.map((p) => [String(p.user), p]));
  const data = advisors.map((a) => ({ user: a, profile: map.get(String(a._id)) || null }));
  return sendResponse(res, { data });
});
