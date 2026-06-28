import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import stripe from '../config/stripe.js';
import Transaction from '../models/transaction.model.js';
import Wallet from '../models/wallet.model.js';
import Session from '../models/session.model.js';
import User from '../models/user.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import { getPlatformSettings } from '../models/platformSetting.model.js';
import { logAdminActivity } from '../services/activity.service.js';

const round2 = (n) => Math.round((n || 0) * 100) / 100;

// Money the platform collects from users.
const REVENUE_TYPES = ['credit_pack_purchase', 'wallet_topup', 'subscription', 'promotion_purchase'];
// Money owed to / earned by advisors.
const ADVISOR_TYPES = ['advisor_earning', 'advisor_tip'];
const REFUND_TYPES = ['session_refund', 'subscription_refund'];

const periodBounds = () => {
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const week = new Date(today); week.setDate(today.getDate() - today.getDay()); // Sunday start
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const year = new Date(now.getFullYear(), 0, 1);
  return { today, week, month, year };
};

const sumTypes = async (types, match = {}) => {
  const agg = await Transaction.aggregate([
    { $match: { status: 'completed', type: { $in: types }, ...match } },
    { $group: { _id: null, t: { $sum: '$amount' }, c: { $sum: 1 } } }
  ]);
  return { amount: round2(agg[0]?.t || 0), count: agg[0]?.c || 0 };
};

const periodStats = async (since) => {
  const m = since ? { createdAt: { $gte: since } } : {};
  const [g, a, r] = await Promise.all([
    sumTypes(REVENUE_TYPES, m),
    sumTypes(ADVISOR_TYPES, m),
    sumTypes(REFUND_TYPES, m)
  ]);
  return {
    gross: g.amount,
    advisorPayouts: a.amount,
    refunds: r.amount,
    net: round2(g.amount - a.amount - r.amount)
  };
};

export const overview = catchAsync(async (req, res) => {
  const { today, week, month, year } = periodBounds();

  const [pToday, pWeek, pMonth, pYear, pAll] = await Promise.all([
    periodStats(today), periodStats(week), periodStats(month), periodStats(year), periodStats(null)
  ]);

  // Wallet metrics
  const [deposits, balanceAgg] = await Promise.all([
    sumTypes(['credit_pack_purchase', 'wallet_topup']),
    Wallet.aggregate([{ $group: { _id: null, balance: { $sum: '$balance' }, free: { $sum: '$freeCredits' } } }])
  ]);

  // Payout metrics by withdrawal status
  const payoutAgg = await Transaction.aggregate([
    { $match: { type: 'advisor_payout' } },
    { $group: { _id: '$withdrawalStatus', amount: { $sum: '$amount' }, count: { $sum: 1 } } }
  ]);
  const pay = (k) => payoutAgg.find((p) => p._id === k) || { amount: 0, count: 0 };

  // Advisor metrics
  const topEarnerAgg = await Transaction.aggregate([
    { $match: { status: 'completed', type: { $in: ADVISOR_TYPES } } },
    { $group: { _id: '$advisor', total: { $sum: '$amount' } } },
    { $sort: { total: -1 } },
    { $limit: 1 }
  ]);
  let topEarner = null;
  if (topEarnerAgg[0]?._id) {
    const u = await User.findById(topEarnerAgg[0]._id).select('name profilePhoto').lean();
    if (u) topEarner = { name: u.name, profilePhoto: u.profilePhoto, amount: round2(topEarnerAgg[0].total) };
  }
  const lowestRatedProfile = await AdvisorProfile.find({ ratingsCount: { $gt: 0 } })
    .sort({ avgRating: 1 }).limit(1).populate('user', 'name profilePhoto').lean();
  const lowestRated = lowestRatedProfile[0]?.user
    ? { name: lowestRatedProfile[0].user.name, rating: lowestRatedProfile[0].avgRating }
    : null;

  // Revenue analytics — this year by month
  const monthlyAgg = await Transaction.aggregate([
    { $match: { status: 'completed', type: { $in: REVENUE_TYPES }, createdAt: { $gte: year } } },
    { $group: { _id: { $month: '$createdAt' }, total: { $sum: '$amount' } } }
  ]);
  const revenueByMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0 }));
  monthlyAgg.forEach((m) => { revenueByMonth[m._id - 1].total = round2(m.total); });

  // Revenue sources breakdown
  const sessionRev = await Session.aggregate([
    { $match: { status: 'completed' } },
    { $group: { _id: '$type', total: { $sum: '$chargedAmount' } } }
  ]);
  const sessMap = Object.fromEntries(sessionRev.map((s) => [s._id, s.total]));
  const [subRev, unlockRev, promoRev] = await Promise.all([
    sumTypes(['credit_pack_purchase', 'wallet_topup']),
    sumTypes(['unlock_recording', 'unlock_transcript']),
    sumTypes(['promotion_purchase'])
  ]);

  return sendResponse(res, {
    data: {
      // legacy keys (kept so existing widgets keep working)
      monthlyRevenue: pMonth.gross,
      pendingPayouts: pay('requested').amount,
      pendingPayoutsCount: pay('requested').count,
      platformCommission: pAll.net,

      platformRevenue: { today: pToday.gross, week: pWeek.gross, month: pMonth.gross, year: pYear.gross, allTime: pAll.gross },
      netRevenue: { today: pToday.net, week: pWeek.net, month: pMonth.net, year: pYear.net, allTime: pAll.net },
      wallet: {
        totalDeposits: deposits.amount,
        totalBalance: round2(balanceAgg[0]?.balance || 0),
        totalFreeCredits: round2(balanceAgg[0]?.free || 0)
      },
      payouts: {
        pending: pay('requested'),
        approved: pay('approved'),
        paid: pay('paid'),
        failed: pay('rejected')
      },
      advisors: {
        totalEarnings: pAll.advisorPayouts,
        topEarner,
        lowestRated
      },
      revenueByMonth,
      revenueSources: {
        voiceSessions: round2(sessMap.call || 0),
        videoSessions: round2(sessMap.video || 0),
        chatSessions: round2(sessMap.chat || 0),
        creditPackRevenue: subRev.amount,
        subscriptionRevenue: 0,
        recordingPurchases: unlockRev.amount,
        featuredAdvisorFees: promoRev.amount
      }
    }
  });
});

// Advisor Earnings tab — per-advisor gross/commission/net/paid figures.
export const advisorEarnings = catchAsync(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const agg = await Transaction.aggregate([
    { $match: { status: 'completed', advisor: { $ne: null } } },
    {
      $group: {
        _id: '$advisor',
        grossEarnings: { $sum: { $cond: [{ $in: ['$type', ADVISOR_TYPES] }, '$amount', 0] } },
        platformCommission: { $sum: { $cond: [{ $eq: ['$type', 'platform_commission'] }, '$amount', 0] } },
        paidEarnings: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ['$type', 'advisor_payout'] }, { $eq: ['$withdrawalStatus', 'paid'] }] },
              '$amount',
              0
            ]
          }
        }
      }
    },
    { $sort: { grossEarnings: -1 } }
  ]);

  const total = agg.length;
  const start = (page - 1) * limit;
  const pageItems = agg.slice(start, start + limit);
  const ids = pageItems.map((x) => x._id);
  const [users, profiles] = await Promise.all([
    User.find({ _id: { $in: ids } }).select('name email profilePhoto').lean(),
    AdvisorProfile.find({ user: { $in: ids } }).select('user tier totalSessions').lean()
  ]);
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  const pMap = new Map(profiles.map((p) => [String(p.user), p]));

  const data = pageItems.map((x) => ({
    advisor: uMap.get(String(x._id)) || null,
    tier: pMap.get(String(x._id))?.tier === 'bronze' ? 'silver' : pMap.get(String(x._id))?.tier || 'silver',
    totalSessions: pMap.get(String(x._id))?.totalSessions || 0,
    grossEarnings: round2(x.grossEarnings),
    platformCommission: round2(x.platformCommission),
    netEarnings: round2(x.grossEarnings),
    paidEarnings: round2(x.paidEarnings)
  }));

  return sendResponse(res, { data, meta: buildMeta({ page, limit, total }) });
});

// CSV export for any finance report (PDF/Excel can be layered on later).
const csvEscape = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (headers, rows) =>
  [headers.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n');

export const exportReport = catchAsync(async (req, res) => {
  const report = String(req.query.report || 'transactions');
  let headers = [];
  let rows = [];

  if (report === 'advisor-earnings') {
    const agg = await Transaction.aggregate([
      { $match: { status: 'completed', advisor: { $ne: null } } },
      {
        $group: {
          _id: '$advisor',
          gross: { $sum: { $cond: [{ $in: ['$type', ADVISOR_TYPES] }, '$amount', 0] } },
          commission: { $sum: { $cond: [{ $eq: ['$type', 'platform_commission'] }, '$amount', 0] } },
          paid: { $sum: { $cond: [{ $and: [{ $eq: ['$type', 'advisor_payout'] }, { $eq: ['$withdrawalStatus', 'paid'] }] }, '$amount', 0] } }
        }
      },
      { $sort: { gross: -1 } }
    ]);
    const users = await User.find({ _id: { $in: agg.map((a) => a._id) } }).select('name email').lean();
    const uMap = new Map(users.map((u) => [String(u._id), u]));
    headers = ['Advisor', 'Email', 'Gross Earnings', 'Platform Commission', 'Net Earnings', 'Paid Earnings'];
    rows = agg.map((a) => {
      const u = uMap.get(String(a._id));
      return [u?.name || '', u?.email || '', round2(a.gross), round2(a.commission), round2(a.gross), round2(a.paid)];
    });
  } else if (report === 'payouts') {
    const txs = await Transaction.find({ type: 'advisor_payout' })
      .populate('advisor', 'name email').sort({ createdAt: -1 }).limit(5000).lean();
    headers = ['Payout ID', 'Advisor', 'Email', 'Amount', 'Status', 'Method', 'Date'];
    rows = txs.map((t) => [t.txCode || t._id, t.advisor?.name || '', t.advisor?.email || '', t.amount, t.withdrawalStatus || '', t.withdrawalMethod || '', new Date(t.createdAt).toISOString()]);
  } else {
    // transactions (default), respects type/status query filters
    const filter = {};
    if (req.query.type) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;
    const txs = await Transaction.find(filter)
      .populate('user', 'name email').populate('advisor', 'name email')
      .sort({ createdAt: -1 }).limit(5000).lean();
    headers = ['Transaction ID', 'Type', 'Status', 'User', 'Advisor', 'Amount', 'Currency', 'Date', 'Description'];
    rows = txs.map((t) => [
      t.txCode || t._id, t.type, t.status,
      t.user?.name || '', t.advisor?.name || '', t.amount, (t.currency || 'usd').toUpperCase(),
      new Date(t.createdAt).toISOString(), (t.description || '').replace(/\n/g, ' ')
    ]);
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${report}-report.csv"`);
  return res.send(toCsv(headers, rows));
});

export const deleteTransaction = catchAsync(async (req, res) => {
  const tx = await Transaction.findById(req.params.id);
  if (!tx) throw new ApiError(StatusCodes.NOT_FOUND, 'Transaction not found');
  if (tx.type === 'advisor_payout' && tx.withdrawalStatus === 'requested') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Cannot delete a pending payout');
  }
  await tx.deleteOne();
  return sendResponse(res, { message: 'Transaction deleted' });
});

export const listTransactions = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = {};
  if (req.query.type) filter.type = req.query.type;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) {
    const q = String(req.query.q).trim();
    const users = await User.find({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ]
    }).select('_id').lean();
    const ids = users.map((u) => u._id);
    filter.$or = [
      { txCode: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
      { user: { $in: ids } },
      { advisor: { $in: ids } }
    ];
  }

  const total = await Transaction.countDocuments(filter);
  const items = await Transaction.find(filter)
    .populate('user', 'name profilePhoto email')
    .populate('advisor', 'name profilePhoto email')
    .populate('plan', 'name')
    .sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

export const listPayouts = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { type: 'advisor_payout' };
  if (req.query.status) filter.withdrawalStatus = req.query.status;
  if (req.query.q) {
    const q = String(req.query.q).trim();
    const advisors = await User.find({
      role: 'advisor',
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ]
    }).select('_id').lean();
    filter.$or = [
      { txCode: { $regex: q, $options: 'i' } },
      { advisor: { $in: advisors.map((u) => u._id) } }
    ];
  }

  const total = await Transaction.countDocuments(filter);
  const items = await Transaction.find(filter)
    .populate('advisor', 'name profilePhoto email stripeConnectId')
    .sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

export const approvePayout = catchAsync(async (req, res) => {
  const tx = await Transaction.findById(req.params.id);
  if (!tx || tx.type !== 'advisor_payout') throw new ApiError(StatusCodes.NOT_FOUND, 'Payout not found');
  if (tx.withdrawalStatus !== 'requested') throw new ApiError(StatusCodes.BAD_REQUEST, 'Payout not in requested state');

  // Move pendingPayouts -> totalWithdrawn on advisor wallet (assume external transfer)
  const wallet = await Wallet.findOne({ user: tx.advisor });
  if (!wallet) throw new ApiError(StatusCodes.NOT_FOUND, 'Wallet not found');
  if (wallet.pendingPayouts < tx.amount) throw new ApiError(StatusCodes.BAD_REQUEST, 'Wallet pending payouts mismatch');

  wallet.pendingPayouts = round2(wallet.pendingPayouts - tx.amount);
  wallet.totalWithdrawn = round2(wallet.totalWithdrawn + tx.amount);
  await wallet.save();

  tx.withdrawalStatus = 'paid';
  tx.status = 'completed';
  tx.withdrawalApprovedBy = req.user._id;
  await tx.save();

  await logAdminActivity({
    adminId: req.user?._id,
    action: 'payout.approve',
    description: `Approved advisor payout of $${tx.amount}`,
    targetType: 'payout',
    targetUser: tx.advisor
  });

  return sendResponse(res, { message: 'Payout approved', data: tx });
});

export const rejectPayout = catchAsync(async (req, res) => {
  const { reason } = req.body;
  const tx = await Transaction.findById(req.params.id);
  if (!tx || tx.type !== 'advisor_payout') throw new ApiError(StatusCodes.NOT_FOUND, 'Payout not found');
  if (tx.withdrawalStatus !== 'requested') throw new ApiError(StatusCodes.BAD_REQUEST, 'Payout not in requested state');

  // Return funds to advisor earnings balance
  const wallet = await Wallet.findOne({ user: tx.advisor });
  if (wallet) {
    wallet.pendingPayouts = round2(Math.max(0, wallet.pendingPayouts - tx.amount));
    wallet.earningsBalance = round2(wallet.earningsBalance + tx.amount);
    await wallet.save();
  }

  tx.withdrawalStatus = 'rejected';
  tx.withdrawalRejectedReason = reason || '';
  tx.status = 'cancelled';
  await tx.save();

  await logAdminActivity({
    adminId: req.user?._id,
    action: 'payout.reject',
    description: `Rejected advisor payout of $${tx.amount}`,
    targetType: 'payout',
    targetUser: tx.advisor
  });

  return sendResponse(res, { message: 'Payout rejected', data: tx });
});

export const updateCommissions = catchAsync(async (req, res) => {
  const { silver, gold, platinum } = req.body;
  const settings = await getPlatformSettings();
  const apply = (key, value) => {
    if (typeof value === 'undefined') return;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new ApiError(StatusCodes.BAD_REQUEST, `${key} commission must be between 0 and 100`);
    }
    settings.commissions[key] = n;
  };
  apply('silver', silver);
  apply('gold', gold);
  apply('platinum', platinum);
  await settings.save();
  return sendResponse(res, { message: 'Commissions updated', data: settings.commissions });
});

export const getCommissions = catchAsync(async (_req, res) => {
  const settings = await getPlatformSettings();
  return sendResponse(res, { data: settings.commissions });
});

export const updateMinWithdrawal = catchAsync(async (req, res) => {
  const { min } = req.body;
  const settings = await getPlatformSettings();
  settings.minWithdrawal = Number(min);
  await settings.save();
  return sendResponse(res, { data: settings });
});
