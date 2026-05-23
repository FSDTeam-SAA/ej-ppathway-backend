import catchAsync from '../utils/catchAsync.js';
import sendResponse from '../utils/sendResponse.js';
import User from '../models/user.model.js';
import UserSubscription from '../models/userSubscription.model.js';
import Transaction from '../models/transaction.model.js';
import Session from '../models/session.model.js';

export const dashboardOverview = catchAsync(async (_req, res) => {
  const [totalUsers, totalAdvisors, totalActiveSubs, totalSessions] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    User.countDocuments({ role: 'advisor' }),
    UserSubscription.countDocuments({ status: 'active' }),
    Session.countDocuments({})
  ]);

  const totalRevenueAgg = await Transaction.aggregate([
    { $match: { status: 'completed', type: { $in: ['platform_commission', 'subscription', 'wallet_topup', 'unlock_recording', 'unlock_transcript', 'promotion_purchase'] } } },
    { $group: { _id: null, t: { $sum: '$amount' } } }
  ]);

  // weekly users registrations
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const usersByDay = await User.aggregate([
    { $match: { role: 'user', createdAt: { $gte: weekAgo } } },
    { $group: { _id: { $dayOfWeek: '$createdAt' }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);

  // total advisors by category
  const advisorsByCategory = await User.aggregate([
    { $match: { role: 'advisor' } },
    { $lookup: { from: 'advisorprofiles', localField: '_id', foreignField: 'user', as: 'p' } },
    { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
    { $unwind: { path: '$p.expertise', preserveNullAndEmptyArrays: true } },
    { $group: { _id: '$p.expertise', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);

  // monthly revenue trend (last 12 months)
  const yearAgo = new Date(); yearAgo.setMonth(yearAgo.getMonth() - 11); yearAgo.setDate(1); yearAgo.setHours(0,0,0,0);
  const revenueByMonth = await Transaction.aggregate([
    { $match: {
        status: 'completed',
        type: { $in: ['platform_commission', 'subscription', 'wallet_topup', 'unlock_recording', 'unlock_transcript', 'promotion_purchase'] },
        createdAt: { $gte: yearAgo }
    }},
    { $group: { _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } }, total: { $sum: '$amount' } } },
    { $sort: { '_id.y': 1, '_id.m': 1 } }
  ]);

  // popular service categories from sessions
  const popularCategories = await Session.aggregate([
    { $lookup: { from: 'advisorprofiles', localField: 'advisor', foreignField: 'user', as: 'p' } },
    { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
    { $unwind: { path: '$p.expertise', preserveNullAndEmptyArrays: true } },
    { $group: { _id: '$p.expertise', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 }
  ]);

  const recentTransactions = await Transaction.find({})
    .populate('user', 'name profilePhoto email')
    .populate('advisor', 'name profilePhoto email')
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  return sendResponse(res, {
    data: {
      totals: {
        users: totalUsers,
        advisors: totalAdvisors,
        subscriptions: totalActiveSubs,
        sessions: totalSessions,
        revenue: totalRevenueAgg[0]?.t || 0
      },
      usersByDay,
      advisorsByCategory,
      revenueByMonth,
      popularCategories,
      recentTransactions
    }
  });
});
