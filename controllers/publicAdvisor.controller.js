import { StatusCodes } from 'http-status-codes';
import mongoose from 'mongoose';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import User from '../models/user.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import Review from '../models/review.model.js';
import Favorite from '../models/favorite.model.js';
import { buildAdvisorAvailability } from './session.controller.js';

const buildFilters = (q) => {
  const filter = {
    $and: [
      {
        $or: [
          { profileReviewStatus: 'approved' },
          { profileReviewStatus: { $exists: false } }
        ]
      }
    ]
  };
  if (q.expertise) filter.expertise = { $in: String(q.expertise).split(',') };
  if (q.styles) filter.styles = { $in: String(q.styles).split(',') };
  if (q.languages) filter.languages = { $in: String(q.languages).split(',') };
  if (q.tier) filter.tier = q.tier;
  if (q.availableNow === 'true') filter.isOnline = true;

  // Connection method → advisor must offer a positive per-minute price for the
  // selected channel(s). chat | call | video map onto the pricing sub-fields.
  if (q.connection) {
    const map = { chat: 'pricing.chatPerMin', call: 'pricing.callPerMin', video: 'pricing.videoPerMin' };
    const conds = String(q.connection)
      .split(',')
      .map((c) => map[c.trim()])
      .filter(Boolean)
      .map((path) => ({ [path]: { $gt: 0 } }));
    if (conds.length) filter.$and = filter.$and.concat(conds);
  }

  return filter;
};

const buildSort = (q) => {
  if (q.sortBy === 'price_low') return { 'pricing.chatPerMin': 1 };
  if (q.sortBy === 'price_high') return { 'pricing.chatPerMin': -1 };
  if (q.sortBy === 'alphabetical') return { 'userName': 1 };
  if (q.sortBy === 'rating') return { avgRating: -1 };
  return { tier: -1, avgRating: -1, totalSessions: -1 };
};

const parseTimezoneOffsetMinutes = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < -14 * 60 || parsed > 14 * 60) return null;
  return parsed;
};


const populateUser = async (profiles) => {
  const ids = profiles.map((p) => p.user);
  const users = await User.find({ _id: { $in: ids } }).lean();
  const map = new Map(users.map((u) => [String(u._id), u]));
  return profiles.map((p) => ({ profile: p, user: map.get(String(p.user)) || null }));
};

const normalizeTags = (items = []) =>
  items
    .map((item) => String(item || '').trim())
    .filter(Boolean);

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
  if (profile?.profileReviewStatus && profile.profileReviewStatus !== 'approved') {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor not found');
  }

  let isFavorite = false;
  if (req.user) {
    isFavorite = !!(await Favorite.findOne({ user: req.user._id, advisor: advisorId }));
  }

  // Increment promotion view counter if active promotion
  if (profile?.activePromotion?.expiresAt && profile.activePromotion.expiresAt > new Date()) {
    await AdvisorProfile.updateOne({ user: advisorId }, { $inc: { 'activePromotion.profileViews': 1 } });
  }

  const advisorObjectId = new mongoose.Types.ObjectId(advisorId);
  const reviewFilter = { advisor: advisorObjectId, isAdminShowcase: { $ne: true } };
  const [reviewStats] = await Review.aggregate([
    { $match: reviewFilter },
    {
      $group: {
        _id: '$advisor',
        ratingsCount: { $sum: 1 },
        avgRating: { $avg: '$rating' }
      }
    }
  ]);

  const publicProfile = profile
    ? {
        ...profile,
        avgRating: reviewStats ? Math.round(reviewStats.avgRating * 100) / 100 : 0,
        ratingsCount: reviewStats?.ratingsCount || 0
      }
    : profile;

  // Recent reviews
  const reviews = await Review.find(reviewFilter)
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('user', 'name profilePhoto')
    .lean();

  return sendResponse(res, { data: { user, profile: publicProfile, reviews, isFavorite } });
});

export const recommendedAdvisors = catchAsync(async (req, res) => {
  const { advisorId } = req.params;
  const { limit } = parsePagination(req.query);

  const profile = await AdvisorProfile.findOne({ user: advisorId }).lean();
  if (!profile) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor not found');

  const expertise = normalizeTags(profile.expertise);
  const styles = normalizeTags(profile.styles);
  const languages = normalizeTags(profile.languages);

  const approvedFilter = {
    user: { $ne: profile.user },
    $and: [
      {
        $or: [
          { profileReviewStatus: 'approved' },
          { profileReviewStatus: { $exists: false } }
        ]
      }
    ]
  };

  const matchFilters = [];
  if (expertise.length) matchFilters.push({ expertise: { $in: expertise } });
  if (styles.length) matchFilters.push({ styles: { $in: styles } });
  if (languages.length) matchFilters.push({ languages: { $in: languages } });

  const matchedProfiles = matchFilters.length
    ? await AdvisorProfile.find({ ...approvedFilter, $or: matchFilters }).lean()
    : [];

  const matchedIds = new Set(matchedProfiles.map((item) => String(item._id)));
  let profiles = matchedProfiles;

  if (profiles.length < limit) {
    const fallback = await AdvisorProfile.find({
      ...approvedFilter,
      _id: { $nin: Array.from(matchedIds) }
    })
      .sort({ avgRating: -1, ratingsCount: -1, totalSessions: -1 })
      .limit(limit - profiles.length)
      .lean();
    profiles = profiles.concat(fallback);
  }

  const score = (candidate) => {
    const candidateExpertise = new Set(normalizeTags(candidate.expertise));
    const candidateStyles = new Set(normalizeTags(candidate.styles));
    const candidateLanguages = new Set(normalizeTags(candidate.languages));
    const expertiseScore = expertise.filter((item) => candidateExpertise.has(item)).length * 10;
    const styleScore = styles.filter((item) => candidateStyles.has(item)).length * 4;
    const languageScore = languages.filter((item) => candidateLanguages.has(item)).length * 2;
    return (
      expertiseScore +
      styleScore +
      languageScore +
      Number(candidate.avgRating || 0) +
      Math.min(Number(candidate.totalSessions || 0) / 100, 5)
    );
  };

  const ranked = profiles
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit);
  const data = await populateUser(ranked);

  return sendResponse(res, { data });
});

export const getAdvisorAvailability = catchAsync(async (req, res) => {
  const data = await buildAdvisorAvailability({
    advisorId: req.params.advisorId,
    date: req.query.date,
    durationMinutes: req.query.durationMinutes,
    viewerTimezone: req.query.timezone,
    viewerOffsetMinutes: parseTimezoneOffsetMinutes(req.query.timezoneOffsetMinutes)
  });
  return sendResponse(res, { data });
});
