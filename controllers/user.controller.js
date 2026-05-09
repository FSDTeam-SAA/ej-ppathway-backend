import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { uploadBufferToCloudinary } from '../services/upload.service.js';
import User from '../models/user.model.js';
import Favorite from '../models/favorite.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';

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
