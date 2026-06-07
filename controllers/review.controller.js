import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import Review from '../models/review.model.js';
import Session from '../models/session.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import { uploadBufferToCloudinary } from '../services/upload.service.js';

const round2 = (n) => Math.round(n * 100) / 100;

const recomputeAdvisorAggregates = async (advisorId) => {
  const reviews = await Review.find({ advisor: advisorId, isAdminShowcase: { $ne: true } });
  if (!reviews.length) {
    await AdvisorProfile.findOneAndUpdate({ user: advisorId }, {
      avgRating: 0, ratingsCount: 0,
      ratingBreakdown: {}
    });
    return;
  }
  const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
  const count = reviews.length;
  const avg = round2(sum / count);

  const keys = ['accuracy','clarity','helpfulness','valuable','communication','professionalism','valueForMoney','expertise'];
  const breakdown = {};
  for (const k of keys) {
    const total = reviews.reduce((acc, r) => acc + (r.breakdown?.[k] || 0), 0);
    breakdown[k] = round2(total / count);
  }
  await AdvisorProfile.findOneAndUpdate({ user: advisorId }, {
    avgRating: avg,
    ratingsCount: count,
    ratingBreakdown: breakdown
  });
};

export const submitReview = catchAsync(async (req, res) => {
  const { sessionId, rating, breakdown, comment } = req.body;
  const session = await Session.findById(sessionId);
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  if (String(session.user) !== String(req.user._id)) throw new ApiError(StatusCodes.FORBIDDEN, 'Forbidden');
  if (!['completed', 'cancelled', 'flagged', 'disputed'].includes(session.status)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'You can only review after a session ends');
  }

  const r = await Review.findOneAndUpdate(
    { user: req.user._id, session: session._id },
    {
      $set: {
        user: req.user._id,
        advisor: session.advisor,
        session: session._id,
        rating: Math.max(1, Math.min(5, Number(rating) || 5)),
        breakdown: breakdown || {},
        comment: comment || '',
        sessionType: session.type
      }
    },
    { upsert: true, new: true }
  );

  session.review = r._id;
  await session.save();

  await recomputeAdvisorAggregates(session.advisor);

  return sendResponse(res, { message: 'Review submitted', data: r });
});

export const listAdvisorReviews = catchAsync(async (req, res) => {
  const { advisorId } = req.params;
  const { skip, limit, page } = parsePagination(req.query);

  const filter = { advisor: advisorId };
  const total = await Review.countDocuments(filter);
  const items = await Review.find(filter)
    .populate('user', 'name profilePhoto')
    .sort({ createdAt: -1 }).skip(skip).limit(limit).lean();

  // distribution
  const distribution = await Review.aggregate([
    { $match: { advisor: items[0]?.advisor || filter.advisor } },
    { $group: { _id: '$rating', count: { $sum: 1 } } }
  ]);

  return sendResponse(res, {
    data: items,
    meta: { ...buildMeta({ page, limit, total }), distribution }
  });
});

// ===== Admin showcase reviews =====
export const adminCreateShowcaseReview = catchAsync(async (req, res) => {
  const { rating, name, location, comment } = req.body;
  let photo = '';
  if (req.file) {
    const r = await uploadBufferToCloudinary(req.file.buffer, 'showcase-reviews', 'image');
    photo = r.secure_url;
  }
  const review = await Review.create({
    user: req.user._id, // admin as user (placeholder)
    advisor: req.user._id, // not tied to advisor
    rating: Math.max(1, Math.min(5, Number(rating) || 5)),
    comment: comment || '',
    isAdminShowcase: true,
    showcaseName: name,
    showcaseLocation: location,
    showcasePhoto: photo
  });
  return sendResponse(res, { statusCode: StatusCodes.CREATED, message: 'Showcase review created', data: review });
});

export const listShowcaseReviews = catchAsync(async (_req, res) => {
  const items = await Review.find({ isAdminShowcase: true }).sort({ createdAt: -1 }).lean();
  return sendResponse(res, { data: items });
});

// Homepage "What Our Customers Say" — admin-curated featured reviews (mix of real + showcase)
export const listFeaturedTestimonials = catchAsync(async (_req, res) => {
  const items = await Review.find({ isFeaturedTestimonial: true })
    .populate('user', 'name profilePhoto')
    .sort({ updatedAt: -1 })
    .limit(20)
    .lean();
  return sendResponse(res, { data: items });
});

export const adminSetReviewFeatured = catchAsync(async (req, res) => {
  const { id } = req.params;
  const isFeaturedTestimonial = !!req.body?.isFeaturedTestimonial;
  const r = await Review.findByIdAndUpdate(id, { isFeaturedTestimonial }, { new: true });
  if (!r) throw new ApiError(StatusCodes.NOT_FOUND, 'Review not found');
  return sendResponse(res, { data: r, message: 'Featured flag updated' });
});

export const adminListReviewsForCuration = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = {};
  if (req.query.featured === 'true') filter.isFeaturedTestimonial = true;
  if (req.query.featured === 'false') filter.isFeaturedTestimonial = { $ne: true };
  if (req.query.minRating) filter.rating = { $gte: Number(req.query.minRating) };
  const [items, total] = await Promise.all([
    Review.find(filter)
      .populate('user', 'name profilePhoto')
      .populate('advisor', 'name profilePhoto')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Review.countDocuments(filter)
  ]);
  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

export const adminUpdateShowcaseReview = catchAsync(async (req, res) => {
  const update = {};
  for (const k of ['rating', 'showcaseName', 'showcaseLocation', 'comment']) {
    if (typeof req.body[k] !== 'undefined') update[k === 'rating' ? 'rating' : k] = req.body[k];
  }
  if (req.file) {
    const r = await uploadBufferToCloudinary(req.file.buffer, 'showcase-reviews', 'image');
    update.showcasePhoto = r.secure_url;
  }
  const review = await Review.findOneAndUpdate(
    { _id: req.params.id, isAdminShowcase: true },
    update,
    { new: true }
  );
  if (!review) throw new ApiError(StatusCodes.NOT_FOUND, 'Review not found');
  return sendResponse(res, { data: review });
});

export const adminDeleteShowcaseReview = catchAsync(async (req, res) => {
  const review = await Review.findOneAndDelete({ _id: req.params.id, isAdminShowcase: true });
  if (!review) throw new ApiError(StatusCodes.NOT_FOUND, 'Review not found');
  return sendResponse(res, { message: 'Deleted' });
});

// ===== Admin: real user-submitted reviews (moderation) =====
// These are reviews left by real users on advisors (NOT admin showcase items).
export const adminListUserReviews = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { isAdminShowcase: { $ne: true } };
  if (req.query.minRating) filter.rating = { $gte: Number(req.query.minRating) };
  if (req.query.q) filter.comment = { $regex: String(req.query.q), $options: 'i' };
  const [items, total] = await Promise.all([
    Review.find(filter)
      .populate('user', 'name profilePhoto email')
      .populate('advisor', 'name profilePhoto')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Review.countDocuments(filter)
  ]);
  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

export const adminUpdateUserReview = catchAsync(async (req, res) => {
  const update = {};
  if (typeof req.body.rating !== 'undefined') {
    update.rating = Math.max(1, Math.min(5, Number(req.body.rating) || 1));
  }
  if (typeof req.body.comment !== 'undefined') update.comment = req.body.comment;
  const review = await Review.findOneAndUpdate(
    { _id: req.params.id, isAdminShowcase: { $ne: true } },
    update,
    { new: true }
  );
  if (!review) throw new ApiError(StatusCodes.NOT_FOUND, 'Review not found');
  // Real reviews affect the advisor's rating, so keep aggregates in sync.
  await recomputeAdvisorAggregates(review.advisor);
  return sendResponse(res, { data: review, message: 'Review updated' });
});

export const adminDeleteUserReview = catchAsync(async (req, res) => {
  const review = await Review.findOneAndDelete({ _id: req.params.id, isAdminShowcase: { $ne: true } });
  if (!review) throw new ApiError(StatusCodes.NOT_FOUND, 'Review not found');
  if (review.session) {
    await Session.findByIdAndUpdate(review.session, { $unset: { review: 1 } });
  }
  await recomputeAdvisorAggregates(review.advisor);
  return sendResponse(res, { message: 'Review deleted' });
});
