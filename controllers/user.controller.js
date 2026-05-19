import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { uploadBufferToCloudinary } from '../services/upload.service.js';
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
  const allowed = ['name', 'phone', 'location', 'timezone', 'language', 'profilePhoto'];
  const update = {};
  for (const key of allowed) {
    if (typeof req.body[key] !== 'undefined') update[key] = req.body[key];
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

  const update = { preferences: {} };

  if (typeof seekingHelpWith !== 'undefined') {
    validateArray('seekingHelpWith', seekingHelpWith);
    update.preferences.seekingHelpWith = seekingHelpWith;
  }
  if (typeof guidanceType !== 'undefined') {
    validateSingle('guidanceType', guidanceType);
    update.preferences.guidanceType = guidanceType;
  }
  if (typeof connectionMethods !== 'undefined') {
    validateArray('connectionMethods', connectionMethods);
    update.preferences.connectionMethods = connectionMethods;
  }
  if (typeof atmosphere !== 'undefined') {
    validateSingle('atmosphere', atmosphere);
    update.preferences.atmosphere = atmosphere;
  }
  if (typeof guidanceFrequency !== 'undefined') {
    validateSingle('guidanceFrequency', guidanceFrequency);
    update.preferences.guidanceFrequency = guidanceFrequency;
  }
  if (typeof tailoredAreas !== 'undefined') {
    validateArray('tailoredAreas', tailoredAreas);
    update.preferences.tailoredAreas = tailoredAreas;
  }
  if (typeof guideQualityPriority !== 'undefined') {
    validateSingle('guideQualityPriority', guideQualityPriority);
    update.preferences.guideQualityPriority = guideQualityPriority;
  }
  if (typeof usedPlatformBefore !== 'undefined') {
    if (typeof usedPlatformBefore !== 'boolean') {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'usedPlatformBefore must be boolean');
    }
    update.preferences.usedPlatformBefore = usedPlatformBefore;
  }

  // Merge with existing answers so partial submissions (per-step) work too.
  const existing = await User.findById(req.user._id).lean();
  if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  const merged = { ...(existing.preferences || {}), ...update.preferences };

  // Mark complete only when every required step has been answered.
  const completed =
    Array.isArray(merged.seekingHelpWith) && merged.seekingHelpWith.length > 0 &&
    !!merged.guidanceType &&
    Array.isArray(merged.connectionMethods) && merged.connectionMethods.length > 0 &&
    !!merged.atmosphere &&
    !!merged.guidanceFrequency &&
    Array.isArray(merged.tailoredAreas) && merged.tailoredAreas.length > 0 &&
    !!merged.guideQualityPriority &&
    typeof merged.usedPlatformBefore === 'boolean';

  if (completed) merged.completedAt = new Date();

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { preferences: merged, onboardingCompleted: completed },
    { new: true }
  );

  return sendResponse(res, {
    message: completed ? 'Onboarding complete' : 'Preferences saved',
    data: { preferences: user.preferences, onboardingCompleted: user.onboardingCompleted }
  });
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
