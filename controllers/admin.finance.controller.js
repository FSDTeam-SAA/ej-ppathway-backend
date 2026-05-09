import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import stripe from '../config/stripe.js';
import Transaction from '../models/transaction.model.js';
import Wallet from '../models/wallet.model.js';
import { getPlatformSettings } from '../models/platformSetting.model.js';

const round2 = (n) => Math.round(n * 100) / 100;

export const overview = catchAsync(async (req, res) => {
  // monthly revenue = topups + commissions + subscription + unlocks + promotions completed
  const startMonth = new Date(); startMonth.setDate(1); startMonth.setHours(0,0,0,0);
  const monthlyAgg = await Transaction.aggregate([
    { $match: {
        status: 'completed',
        type: { $in: ['platform_commission','subscription','unlock_recording','unlock_transcript','promotion_purchase'] },
        createdAt: { $gte: startMonth }
    }},
    { $group: { _id: null, t: { $sum: '$amount' } } }
  ]);

  // pending payouts
  const pendingPayoutsAgg = await Transaction.aggregate([
    { $match: { type: 'advisor_payout', withdrawalStatus: 'requested' } },
    { $group: { _id: null, t: { $sum: '$amount' }, count: { $sum: 1 } } }
  ]);

  const platformCommissionAgg = await Transaction.aggregate([
    { $match: { type: 'platform_commission', status: 'completed' } },
    { $group: { _id: null, t: { $sum: '$amount' } } }
  ]);

  return sendResponse(res, {
    data: {
      monthlyRevenue: monthlyAgg[0]?.t || 0,
      pendingPayouts: pendingPayoutsAgg[0]?.t || 0,
      pendingPayoutsCount: pendingPayoutsAgg[0]?.count || 0,
      platformCommission: platformCommissionAgg[0]?.t || 0
    }
  });
});

export const listTransactions = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = {};
  if (req.query.type) filter.type = req.query.type;
  if (req.query.status) filter.status = req.query.status;

  const total = await Transaction.countDocuments(filter);
  const items = await Transaction.find(filter)
    .populate('user', 'name profilePhoto email')
    .populate('advisor', 'name profilePhoto email')
    .sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

export const listPayouts = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { type: 'advisor_payout' };
  if (req.query.status) filter.withdrawalStatus = req.query.status;

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
  return sendResponse(res, { message: 'Payout rejected', data: tx });
});

export const updateCommissions = catchAsync(async (req, res) => {
  const { bronze, silver, gold } = req.body;
  const settings = await getPlatformSettings();
  if (typeof bronze === 'number') settings.commissions.bronze = bronze;
  if (typeof silver === 'number') settings.commissions.silver = silver;
  if (typeof gold === 'number') settings.commissions.gold = gold;
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
