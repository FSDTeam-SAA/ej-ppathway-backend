import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import User from '../models/user.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import Review from '../models/review.model.js';
import Favorite from '../models/favorite.model.js';

const buildFilters = (q) => {
  const filter = {};
  if (q.expertise) filter.expertise = { $in: String(q.expertise).split(',') };
  if (q.styles) filter.styles = { $in: String(q.styles).split(',') };
  if (q.languages) filter.languages = { $in: String(q.languages).split(',') };
  if (q.tier) filter.tier = q.tier;
  if (q.availableNow === 'true') filter.isOnline = true;

  return filter;
};

const buildSort = (q) => {
  if (q.sortBy === 'price_low') return { 'pricing.chatPerMin': 1 };
  if (q.sortBy === 'price_high') return { 'pricing.chatPerMin': -1 };
  if (q.sortBy === 'alphabetical') return { 'userName': 1 };
  if (q.sortBy === 'rating') return { avgRating: -1 };
  return { tier: -1, avgRating: -1, totalSessions: -1 };
};

const populateUser = async (profiles) => {
  const ids = profiles.map((p) => p.user);
  const users = await User.find({ _id: { $in: ids } }).lean();
  const map = new Map(users.map((u) => [String(u._id), u]));
  return profiles.map((p) => ({ profile: p, user: map.get(String(p.user)) || null }));
};

// Home featured = admin-curated picks, fallback to top tier+rating when none flagged
export const featured = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { ...buildFilters(req.query) };

  // Prefer admin-curated featured set when present; transparent fallback otherwise.
  const curatedFilter = { ...filter, isFeaturedOnHome: true };
  const curatedTotal = await AdvisorProfile.countDocuments(curatedFilter);
  const useCurated = curatedTotal > 0;
  const effectiveFilter = useCurated ? curatedFilter : filter;

  const total = useCurated ? curatedTotal : await AdvisorProfile.countDocuments(filter);
  const profiles = await AdvisorProfile.find(effectiveFilter)
    .sort({ tier: -1, avgRating: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
  const data = await populateUser(profiles);
  return sendResponse(res, { data, meta: buildMeta({ page, limit, total }) });
});

// Top rated
export const topRated = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = buildFilters(req.query);
  const total = await AdvisorProfile.countDocuments(filter);
  const profiles = await AdvisorProfile.find(filter).sort({ avgRating: -1, ratingsCount: -1 }).skip(skip).limit(limit).lean();
  const data = await populateUser(profiles);
  return sendResponse(res, { data, meta: buildMeta({ page, limit, total }) });
});

// Browser search
export const searchAdvisors = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = buildFilters(req.query);

  let userIds = [];
  if (req.query.q) {
    const term = String(req.query.q).trim();
    const userMatch = await User.find({ role: 'advisor', name: { $regex: term, $options: 'i' } }).select('_id').lean();
    userIds = userMatch.map((u) => u._id);
    filter.$or = [{ user: { $in: userIds } }, { bio: { $regex: term, $options: 'i' } }, { expertise: { $regex: term, $options: 'i' } }];
  }

  const total = await AdvisorProfile.countDocuments(filter);
  const profiles = await AdvisorProfile.find(filter).sort(buildSort(req.query)).skip(skip).limit(limit).lean();
  const data = await populateUser(profiles);
  return sendResponse(res, { data, meta: buildMeta({ page, limit, total }) });
});

// Advisor details (public preview)
export const getAdvisorDetails = catchAsync(async (req, res) => {
  const { advisorId } = req.params;
  const user = await User.findOne({ _id: advisorId, role: 'advisor' }).lean();
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor not found');
  const profile = await AdvisorProfile.findOne({ user: advisorId }).lean();

  let isFavorite = false;
  if (req.user) {
    isFavorite = !!(await Favorite.findOne({ user: req.user._id, advisor: advisorId }));
  }

  // Increment promotion view counter if active promotion
  if (profile?.activePromotion?.expiresAt && profile.activePromotion.expiresAt > new Date()) {
    await AdvisorProfile.updateOne({ user: advisorId }, { $inc: { 'activePromotion.profileViews': 1 } });
  }

  // Recent reviews
  const reviews = await Review.find({ advisor: advisorId })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('user', 'name profilePhoto')
    .lean();

  return sendResponse(res, { data: { user, profile, reviews, isFavorite } });
});
