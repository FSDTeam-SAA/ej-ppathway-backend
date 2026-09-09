import catchAsync from '../utils/catchAsync.js';
import { REVENUE_TYPES, moneyUsdExpr } from '../utils/transactionReporting.js';
import sendResponse from '../utils/sendResponse.js';
import User from '../models/user.model.js';
import UserSubscription from '../models/userSubscription.model.js';
import Transaction from '../models/transaction.model.js';
import Session from '../models/session.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import AdvisorApplication from '../models/advisorApplication.model.js';

const round2 = (n) => Math.round((n || 0) * 100) / 100;

const REFUND_TYPES = ['session_refund', 'subscription_refund'];

// Start of the selected period (defaults to "today").
const periodStart = (period) => {
  const now = new Date();
  const d = new Date(now);
  if (period === 'week') {
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // Sunday
    return d;
  }
  if (period === 'month') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (period === 'year') return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  d.setUTCHours(0, 0, 0, 0); // day
  return d;
};

const bounds = () => {
  const now = new Date();
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0);
  const week = new Date(today); week.setUTCDate(today.getUTCDate() - today.getUTCDay());
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const year = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return { today, week, month, year };
};

const sumRevenue = async (types, since) => {
  const agg = await Transaction.aggregate([
    { $match: { status: 'completed', type: { $in: types }, ...(since ? { createdAt: { $gte: since } } : {}) } },
    { $group: { _id: null, t: { $sum: moneyUsdExpr }, c: { $sum: 1 } } }
  ]);
  return { amount: round2(agg[0]?.t || 0), count: agg[0]?.c || 0 };
};

export const dashboardOverview = catchAsync(async (req, res) => {
  const period = ['day', 'week', 'month', 'year'].includes(req.query.period) ? req.query.period : 'day';
  const start = periodStart(period);
  const { today, week, month, year } = bounds();

  // ---- Period-scoped metric cards (default: today) ----
  const [newUsers, newAdvisors, sessionsCount, subscriptionsCount, revenue] = await Promise.all([
    User.countDocuments({ role: 'user', createdAt: { $gte: start } }),
    User.countDocuments({ role: 'advisor', createdAt: { $gte: start } }),
    Session.countDocuments({ createdAt: { $gte: start } }),
    UserSubscription.countDocuments({ createdAt: { $gte: start } }),
    sumRevenue(REVENUE_TYPES, start).then((r) => r.amount)
  ]);

  // ---- Active Users segmented by subscription plan (within the period) ----
  const subsByPlanAgg = await UserSubscription.aggregate([
    { $match: { createdAt: { $gte: start } } },
    { $group: { _id: '$planName', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);
  const newSubsByPlan = subsByPlanAgg.map((p) => ({ label: p._id || 'Other', value: p.count }));

  // ---- Appointments (booked sessions) today / week / month ----
  const [apptToday, apptWeek, apptMonth] = await Promise.all([
    Session.countDocuments({ createdAt: { $gte: today } }),
    Session.countDocuments({ createdAt: { $gte: week } }),
    Session.countDocuments({ createdAt: { $gte: month } })
  ]);

  // ---- Refunds count by period ----
  const [refToday, refWeek, refMonth, refYear] = await Promise.all([
    sumRevenue(REFUND_TYPES, today),
    sumRevenue(REFUND_TYPES, week),
    sumRevenue(REFUND_TYPES, month),
    sumRevenue(REFUND_TYPES, year)
  ]);
  const [creditRefunds, cashRefunds] = await Promise.all([
    Transaction.aggregate([
      { $match: { type: 'session_refund', status: 'completed', createdAt: { $gte: year } } },
      { $group: { _id: null, amount: { $sum: '$amount' } } }
    ]),
    sumRevenue(['subscription_refund'], year)
  ]);

  // ---- Service categories → Chat / Voice Call / Video Call (within period) ----
  const sessionTypeAgg = await Session.aggregate([
    { $match: { createdAt: { $gte: start } } },
    { $group: { _id: '$type', count: { $sum: 1 } } }
  ]);
  const typeMap = Object.fromEntries(sessionTypeAgg.map((s) => [s._id, s.count]));
  const serviceCategories = [
    { label: 'Chat', value: typeMap.chat || 0, color: '#0d9488' },
    { label: 'Voice Call', value: typeMap.call || 0, color: '#fbbf24' },
    { label: 'Video Call', value: typeMap.video || 0, color: '#06b6d4' }
  ];

  // ---- Advisor performance & activity ----
  const [totalAdvisors, activeAdvisors, deactivatedAdvisors, onlineAdvisors] = await Promise.all([
    User.countDocuments({ role: 'advisor' }),
    User.countDocuments({ role: 'advisor', status: 'active' }),
    User.countDocuments({ role: 'advisor', status: { $in: ['deactivated', 'suspended'] } }),
    AdvisorProfile.countDocuments({ isOnline: true })
  ]);
  const topProfiles = await AdvisorProfile.find({})
    .sort({ totalSessions: -1, avgRating: -1 })
    .limit(5)
    .populate('user', 'name profilePhoto')
    .lean();
  const topPerformers = topProfiles
    .filter((p) => p.user)
    .map((p) => ({
      name: p.user.name,
      profilePhoto: p.user.profilePhoto,
      sessions: p.totalSessions || 0,
      rating: p.avgRating || 0
    }));

  // ---- Advisor approvals (pending applications submitted via website) ----
  const [appApproved, appRejected, appPending] = await Promise.all([
    AdvisorApplication.countDocuments({ status: 'approved' }),
    AdvisorApplication.countDocuments({ status: 'rejected' }),
    AdvisorApplication.countDocuments({ status: { $nin: ['approved', 'rejected'] } })
  ]);

  // ---- Revenue trend (this year, monthly) ----
  const revMonthAgg = await Transaction.aggregate([
    { $match: { status: 'completed', type: { $in: REVENUE_TYPES }, createdAt: { $gte: year } } },
    { $group: { _id: { m: { $month: '$createdAt' } }, total: { $sum: moneyUsdExpr } } }
  ]);
  const revenueByMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0 }));
  revMonthAgg.forEach((r) => { revenueByMonth[r._id.m - 1].total = round2(r.total); });

  const recentTransactions = await Transaction.find({
    type: { $nin: ['platform_commission', 'advisor_earning'] }
  })
    .populate('user', 'name profilePhoto email')
    .populate('advisor', 'name profilePhoto email')
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  return sendResponse(res, {
    data: {
      period,
      metrics: { newUsers, newAdvisors, sessions: sessionsCount, subscriptions: subscriptionsCount, revenue },
      newSubsByPlan,
      appointments: { today: apptToday, week: apptWeek, month: apptMonth },
      refunds: {
        today: refToday.count,
        week: refWeek.count,
        month: refMonth.count,
        year: refYear.count,
        amountYear: cashRefunds.amount,
        creditsYear: creditRefunds[0]?.amount || 0
      },
      serviceCategories,
      advisorPerformance: {
        total: totalAdvisors,
        active: activeAdvisors,
        online: onlineAdvisors,
        suspended: deactivatedAdvisors,
        topPerformers
      },
      approvals: { approved: appApproved, pending: appPending, rejected: appRejected },
      revenueByMonth,
      recentTransactions,

      // legacy keys kept for any other consumer
      totals: {
        users: await User.countDocuments({ role: 'user' }),
        advisors: totalAdvisors,
        subscriptions: await UserSubscription.countDocuments({ status: 'active' }),
        sessions: await Session.countDocuments({}),
        revenue: (await sumRevenue(REVENUE_TYPES, null)).amount
      }
    }
  });
});
