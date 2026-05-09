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

// stats
export const subscriptionStats = catchAsync(async (_req, res) => {
  const totalUsers = await UserSubscription.distinct('user').then((a) => a.length);
  const totalRevenueAgg = await Transaction.aggregate([
    { $match: { type: 'subscription', status: 'completed' } },
    { $group: { _id: null, t: { $sum: '$amount' } } }
  ]);

  // pie distribution by plan
  const planAgg = await UserSubscription.aggregate([
    { $match: { status: 'active' } },
    { $group: { _id: '$planName', count: { $sum: 1 } } }
  ]);

  // monthly revenue
  const yearAgo = new Date(); yearAgo.setMonth(yearAgo.getMonth() - 11); yearAgo.setDate(1); yearAgo.setHours(0,0,0,0);
  const revenueByMonth = await Transaction.aggregate([
    { $match: { type: 'subscription', status: 'completed', createdAt: { $gte: yearAgo } } },
    { $group: { _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } }, total: { $sum: '$amount' } } },
    { $sort: { '_id.y': 1, '_id.m': 1 } }
  ]);

  return sendResponse(res, {
    data: {
      totalUsers,
      totalRevenue: totalRevenueAgg[0]?.t || 0,
      planDistribution: planAgg,
      revenueByMonth
    }
  });
});
