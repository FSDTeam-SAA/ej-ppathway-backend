import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import stripe from '../config/stripe.js';
import Wallet from '../models/wallet.model.js';
import Transaction from '../models/transaction.model.js';
import User from '../models/user.model.js';
import UserSubscription from '../models/userSubscription.model.js';
import Plan from '../models/plan.model.js';
import { getPlatformSettings } from '../models/platformSetting.model.js';

const round2 = (n) => Math.round(n * 100) / 100;

// ===== User wallet =====
export const getMyWallet = catchAsync(async (req, res) => {
  const wallet = await Wallet.findOneAndUpdate(
    { user: req.user._id },
    { $setOnInsert: { user: req.user._id } },
    { new: true, upsert: true }
  );

  // determine plan label
  const sub = await UserSubscription.findOne({ user: req.user._id, status: 'active' }).populate('plan');

  return sendResponse(res, {
    data: {
      wallet,
      activeSubscription: sub
    }
  });
});

export const getMyTransactions = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { $or: [{ user: req.user._id }, { advisor: req.user._id }] };
  if (req.query.type) filter.type = req.query.type;

  const total = await Transaction.countDocuments(filter);
  const items = await Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

// ===== Stripe Checkout for top-up (no webhook flow) =====
export const createTopupCheckout = catchAsync(async (req, res) => {
  const { amount } = req.body;
  const value = Number(amount);
  if (!value || value <= 0) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid amount');
  if (value < 1) throw new ApiError(StatusCodes.BAD_REQUEST, 'Minimum top-up is $1');

  const user = await User.findById(req.user._id);

  // ensure stripe customer
  if (!user.stripeCustomerId) {
    const customer = await stripe.customers.create({ email: user.email, name: user.name });
    user.stripeCustomerId = customer.id;
    await user.save();
  }

  // create a pending transaction first
  const tx = await Transaction.create({
    type: 'wallet_topup',
    status: 'pending',
    user: req.user._id,
    amount: value,
    description: `Wallet top-up of $${value}`
  });

  const successUrl = `${process.env.STRIPE_SUCCESS_URL || (process.env.SERVER_URL + '/api/v1/wallet/topup/success')}?txId=${tx._id}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${process.env.STRIPE_CANCEL_URL || (process.env.SERVER_URL + '/api/v1/wallet/topup/cancel')}?txId=${tx._id}`;

  const checkout = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: user.stripeCustomerId,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(value * 100),
          product_data: { name: 'Wallet Top-up' }
        },
        quantity: 1
      }
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { type: 'wallet_topup', userId: String(req.user._id), txId: String(tx._id) }
  });

  tx.stripeCheckoutSessionId = checkout.id;
  await tx.save();

  return sendResponse(res, {
    data: { checkoutUrl: checkout.url, sessionId: checkout.id, txId: tx._id }
  });
});

// Stripe success route — verifies session, credits wallet (idempotent)
export const stripeTopupSuccess = catchAsync(async (req, res) => {
  const { txId, session_id } = req.query;
  if (!txId || !session_id) throw new ApiError(StatusCodes.BAD_REQUEST, 'Missing parameters');

  const tx = await Transaction.findById(txId);
  if (!tx) throw new ApiError(StatusCodes.NOT_FOUND, 'Transaction not found');

  if (tx.status === 'completed') {
    return sendResponse(res, { message: 'Already credited', data: tx });
  }

  // Re-verify with Stripe
  const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['payment_intent'] });
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Stripe session not found');

  if (session.payment_status !== 'paid') {
    return sendResponse(res, {
      statusCode: StatusCodes.PAYMENT_REQUIRED,
      success: false,
      message: 'Payment not completed yet'
    });
  }

  const amountPaid = (session.amount_total || 0) / 100;
  if (amountPaid <= 0) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Stripe amount');

  const wallet = await Wallet.findOneAndUpdate(
    { user: tx.user },
    { $inc: { balance: amountPaid } },
    { new: true, upsert: true }
  );

  tx.status = 'completed';
  tx.amount = amountPaid;
  tx.stripePaymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  tx.stripeChargeId = session.payment_intent?.latest_charge || undefined;
  await tx.save();

  return sendResponse(res, { message: 'Wallet credited', data: { transaction: tx, wallet } });
});

export const stripeTopupCancel = catchAsync(async (req, res) => {
  const { txId } = req.query;
  if (txId) {
    await Transaction.findByIdAndUpdate(txId, { status: 'cancelled' });
  }
  return sendResponse(res, { message: 'Top-up cancelled' });
});

// ===== Withdrawal =====
export const requestWithdrawal = catchAsync(async (req, res) => {
  if (req.user.role !== 'advisor') throw new ApiError(StatusCodes.FORBIDDEN, 'Advisors only');
  const { amount } = req.body;
  const value = Number(amount);

  const settings = await getPlatformSettings();
  const min = settings.minWithdrawal || 50;
  if (!value || value < min) throw new ApiError(StatusCodes.BAD_REQUEST, `Minimum withdrawal is $${min}`);

  const wallet = await Wallet.findOne({ user: req.user._id });
  if (!wallet) throw new ApiError(StatusCodes.NOT_FOUND, 'Wallet not found');
  if (wallet.earningsBalance < value) throw new ApiError(StatusCodes.PAYMENT_REQUIRED, 'Insufficient earnings balance');

  // hold funds
  wallet.earningsBalance = round2(wallet.earningsBalance - value);
  wallet.pendingPayouts = round2(wallet.pendingPayouts + value);
  await wallet.save();

  const tx = await Transaction.create({
    type: 'advisor_payout',
    status: 'pending',
    advisor: req.user._id,
    amount: value,
    description: 'Advisor payout request',
    withdrawalStatus: 'requested',
    withdrawalRequestedAt: new Date()
  });

  return sendResponse(res, { message: 'Withdrawal requested', data: tx });
});

export const myEarningsOverview = catchAsync(async (req, res) => {
  if (req.user.role !== 'advisor') throw new ApiError(StatusCodes.FORBIDDEN, 'Advisors only');

  const wallet = await Wallet.findOneAndUpdate(
    { user: req.user._id },
    { $setOnInsert: { user: req.user._id } },
    { new: true, upsert: true }
  );

  const startDay = new Date(); startDay.setHours(0,0,0,0);
  const todayEarn = await Transaction.aggregate([
    { $match: { advisor: req.user._id, type: 'advisor_earning', status: 'completed', createdAt: { $gte: startDay } } },
    { $group: { _id: null, t: { $sum: '$amount' } } }
  ]);
  const todayWithdraw = await Transaction.aggregate([
    { $match: { advisor: req.user._id, type: 'advisor_payout', createdAt: { $gte: startDay } } },
    { $group: { _id: null, t: { $sum: '$amount' } } }
  ]);

  // weekly revenue curve
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const curve = await Transaction.aggregate([
    { $match: { advisor: req.user._id, type: 'advisor_earning', status: 'completed', createdAt: { $gte: weekAgo } } },
    { $group: { _id: { $dayOfWeek: '$createdAt' }, total: { $sum: '$amount' } } },
    { $sort: { _id: 1 } }
  ]);

  const totalEarnings = await Transaction.aggregate([
    { $match: { advisor: req.user._id, type: 'advisor_earning', status: 'completed' } },
    { $group: { _id: null, t: { $sum: '$amount' } } }
  ]);
  const totalCommission = await Transaction.aggregate([
    { $match: { advisor: req.user._id, type: 'platform_commission', status: 'completed' } },
    { $group: { _id: null, t: { $sum: '$amount' } } }
  ]);
  const totalWithdraw = await Transaction.aggregate([
    { $match: { advisor: req.user._id, type: 'advisor_payout', withdrawalStatus: 'paid' } },
    { $group: { _id: null, t: { $sum: '$amount' } } }
  ]);

  return sendResponse(res, {
    data: {
      wallet,
      todayEarnings: todayEarn[0]?.t || 0,
      todayWithdrawals: todayWithdraw[0]?.t || 0,
      revenueCurve: curve,
      grossEarnings: totalEarnings[0]?.t || 0,
      platformFee: totalCommission[0]?.t || 0,
      netEarnings: round2((totalEarnings[0]?.t || 0)),
      totalWithdrawn: totalWithdraw[0]?.t || 0
    }
  });
});

export const myEarningsHistory = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { advisor: req.user._id, type: { $in: ['advisor_earning', 'advisor_tip'] } };
  if (req.query.range === 'today') {
    const start = new Date(); start.setHours(0,0,0,0);
    filter.createdAt = { $gte: start };
  } else if (req.query.range === 'week') {
    filter.createdAt = { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
  } else if (req.query.range === 'month') {
    filter.createdAt = { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
  }
  const total = await Transaction.countDocuments(filter);
  const items = await Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
    .populate('user', 'name profilePhoto')
    .populate('session', 'sessionCode type durationMinutes').lean();
  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

export const myWithdrawalsHistory = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { advisor: req.user._id, type: 'advisor_payout' };
  const total = await Transaction.countDocuments(filter);
  const items = await Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

export const deleteEarningRecord = catchAsync(async (req, res) => {
  // soft archive style — we do not actually delete to preserve audit
  const tx = await Transaction.findOneAndUpdate(
    { _id: req.params.id, advisor: req.user._id },
    { $set: { 'metadata.archived': true } },
    { new: true }
  );
  if (!tx) throw new ApiError(StatusCodes.NOT_FOUND, 'Transaction not found');
  return sendResponse(res, { message: 'Archived', data: tx });
});

export const deleteWithdrawalRecord = deleteEarningRecord;
