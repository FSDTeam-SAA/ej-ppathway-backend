import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import Plan from '../models/plan.model.js';
import UserSubscription from '../models/userSubscription.model.js';
import Transaction from '../models/transaction.model.js';

// CRUD plans
export const createPlan = catchAsync(async (req, res) => {
  const plan = await Plan.create(req.body);
  return sendResponse(res, { statusCode: StatusCodes.CREATED, data: plan });
});

export const updatePlan = catchAsync(async (req, res) => {
  const plan = await Plan.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!plan) throw new ApiError(StatusCodes.NOT_FOUND, 'Plan not found');
  return sendResponse(res, { data: plan });
});

export const deletePlan = catchAsync(async (req, res) => {
  const plan = await Plan.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!plan) throw new ApiError(StatusCodes.NOT_FOUND, 'Plan not found');
  return sendResponse(res, { message: 'Plan deactivated', data: plan });
});

export const listPlans = catchAsync(async (_req, res) => {
  const plans = await Plan.find().sort({ sortOrder: 1, pricePerMonth: 1 }).lean();
  return sendResponse(res, { data: plans });
});

const round2 = (n) => Math.round((n || 0) * 100) / 100;
const periodBounds = () => {
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const week = new Date(today); week.setDate(today.getDate() - today.getDay());
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const year = new Date(now.getFullYear(), 0, 1);
  return { today, week, month, year };
};

// Comprehensive subscription analytics for the redesigned page.
export const subscriptionStats = catchAsync(async (_req, res) => {
  const { today, week, month, year } = periodBounds();

  // ---- Subscribers ----
  const [totalUsers, activeTotal, newToday, newWeek, newMonth] = await Promise.all([
    UserSubscription.distinct('user').then((a) => a.length),
    UserSubscription.countDocuments({ status: 'active' }),
    UserSubscription.countDocuments({ createdAt: { $gte: today } }),
    UserSubscription.countDocuments({ createdAt: { $gte: week } }),
    UserSubscription.countDocuments({ createdAt: { $gte: month } })
  ]);

  // ---- Subscription revenue per period ----
  const subRev = async (since) => {
    const agg = await Transaction.aggregate([
      { $match: { type: 'subscription', status: 'completed', ...(since ? { createdAt: { $gte: since } } : {}) } },
      { $group: { _id: null, t: { $sum: '$amount' } } }
    ]);
    return round2(agg[0]?.t || 0);
  };
  const [revToday, revWeek, revMonth, revYear, revAll] = await Promise.all([
    subRev(today), subRev(week), subRev(month), subRev(year), subRev(null)
  ]);

  // ---- Plan distribution (active) ----
  const planDistribution = await UserSubscription.aggregate([
    { $match: { status: 'active' } },
    { $group: { _id: '$planName', count: { $sum: 1 } } }
  ]);

  // ---- Per-plan performance (total / active / cancelled / revenue) ----
  const byPlanStatus = await UserSubscription.aggregate([
    { $group: { _id: { plan: '$planName', status: '$status' }, count: { $sum: 1 } } }
  ]);
  const revByPlanName = await UserSubscription.aggregate([
    { $match: { status: { $in: ['active', 'cancelled', 'expired'] } } },
    { $group: { _id: '$planName', revenue: { $sum: '$pricePerMonthUsd' } } }
  ]);
  const planMap = new Map();
  const ensure = (name) => {
    if (!planMap.has(name)) planMap.set(name, { plan: name, total: 0, active: 0, cancelled: 0, revenue: 0 });
    return planMap.get(name);
  };
  byPlanStatus.forEach((r) => {
    const p = ensure(r._id.plan || 'Unknown');
    p.total += r.count;
    if (r._id.status === 'active') p.active += r.count;
    if (r._id.status === 'cancelled') p.cancelled += r.count;
  });
  revByPlanName.forEach((r) => { ensure(r._id || 'Unknown').revenue = round2(r.revenue); });
  const plans = [...planMap.values()].map((p) => ({
    ...p,
    retentionRate: p.total ? Math.round((p.active / p.total) * 100) : 0,
    cancellationRate: p.total ? Math.round((p.cancelled / p.total) * 100) : 0
  }));
  const pick = (arr, key, dir = 'max') =>
    arr.length
      ? arr.reduce((best, cur) => (dir === 'max' ? cur[key] > best[key] : cur[key] < best[key]) ? cur : best)
      : null;
  const planPerformance = {
    mostPopular: pick(plans, 'total'),
    highestRevenue: pick(plans, 'revenue'),
    highestRetention: pick(plans.filter((p) => p.total >= 1), 'retentionRate'),
    highestCancellation: pick(plans, 'cancellationRate')
  };

  // ---- Renewals ----
  const in7 = new Date(); in7.setDate(in7.getDate() + 7);
  const [dueIn7, expired] = await Promise.all([
    UserSubscription.countDocuments({ status: 'active', renewsAt: { $gte: new Date(), $lte: in7 } }),
    UserSubscription.countDocuments({ status: 'expired' })
  ]);

  // ---- Growth breakdown: new subscribers by month + plan (this year) ----
  const growthAgg = await UserSubscription.aggregate([
    { $match: { createdAt: { $gte: year } } },
    { $group: { _id: { m: { $month: '$createdAt' }, plan: '$planName' }, count: { $sum: 1 } } }
  ]);
  const growthByMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0, plans: {} }));
  growthAgg.forEach((g) => {
    const row = growthByMonth[g._id.m - 1];
    row.total += g.count;
    row.plans[g._id.plan || 'Unknown'] = g.count;
  });

  // ---- Revenue by month (subscription) ----
  const revMonthAgg = await Transaction.aggregate([
    { $match: { type: 'subscription', status: 'completed', createdAt: { $gte: year } } },
    { $group: { _id: { m: { $month: '$createdAt' } }, total: { $sum: '$amount' } } }
  ]);
  const revenueByMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0 }));
  revMonthAgg.forEach((r) => { revenueByMonth[r._id.m - 1].total = round2(r.total); });

  return sendResponse(res, {
    data: {
      // legacy keys
      totalUsers,
      totalRevenue: revAll,
      planDistribution,
      revenueByMonth,

      subscribers: { total: totalUsers, active: activeTotal, today: newToday, week: newWeek, month: newMonth },
      revenue: { today: revToday, week: revWeek, month: revMonth, year: revYear, allTime: revAll },
      planPerformance,
      plans,
      renewals: { dueIn7, expired },
      growthByMonth
    }
  });
});
