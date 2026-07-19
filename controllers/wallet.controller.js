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
import { getPlatformSettings } from '../models/platformSetting.model.js';
import { detectCountry } from '../utils/geo.js';
import { convertUsd, toProviderMinorUnits } from '../services/pricing.service.js';
import { createPaypalOrder, capturePaypalOrder } from '../services/paypal.service.js';
import { isPaypalConfigured } from '../config/paypal.js';
import { getHyperwalletWidgetScriptUrl } from '../config/hyperwallet.js';
import { createHyperwalletAuthenticationToken } from '../services/hyperwallet.service.js';
import { creditUsageSummary, findCreditPack } from '../services/credit.service.js';
import {
  getPayoutConfig,
  creditsToUsd,
  ensureHyperwalletUser,
  removePayoutMethod,
  syncPayoutMethodFromHyperwallet,
  createPayoutRequest
} from '../services/payout.service.js';

const publicPayoutAccount = (advisor) => {
  const hw = advisor.hyperwallet || {};
  return {
    configured: Boolean(hw.userToken),
    status: hw.status || null,
    hasMethod: Boolean(hw.transferMethodToken),
    methodType: hw.transferMethodType || null,
    methodLabel: hw.methodLabel || '',
    currency: hw.currency || 'USD',
    verified: Boolean(hw.verified)
  };
};

const round2 = (n) => Math.round(n * 100) / 100;
const recentDate = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const topupRedirectBase = (kind) => {
  if (kind === 'success') {
    return (
      process.env.STRIPE_WALLET_SUCCESS_URL ||
      process.env.STRIPE_SUCCESS_URL ||
      `${process.env.SERVER_URL}/api/v1/wallet/topup/success`
    );
  }
  return (
    process.env.STRIPE_WALLET_CANCEL_URL ||
    process.env.STRIPE_CANCEL_URL ||
    `${process.env.SERVER_URL}/api/v1/wallet/topup/cancel`
  );
};

const syncTopupWithStripe = async ({ tx, sessionId }) => {
  const sid = (sessionId || tx.stripeCheckoutSessionId || '').trim();
  if (!sid) {
    return { tx, wallet: null, session: null };
  }

  const session = await stripe.checkout.sessions.retrieve(sid, {
    expand: ['payment_intent'],
  });
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Stripe session not found');

  if (tx.status !== 'completed' && session.payment_status === 'paid') {
    const credits = Number(tx.metadata?.totalCredits || tx.metadata?.credits || tx.amountUsd || 0);
    if (credits <= 0) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid credit pack');

    const wallet = await Wallet.findOneAndUpdate(
      { user: tx.user },
      { $inc: { balance: credits } },
      { new: true, upsert: true },
    );

    tx.status = 'completed';
    tx.stripeCheckoutSessionId = tx.stripeCheckoutSessionId || session.id;
    tx.stripePaymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
    tx.stripeChargeId = session.payment_intent?.latest_charge || undefined;
    await tx.save();

    return { tx, wallet, session };
  }

  if (tx.status === 'pending' && session.status === 'expired') {
    tx.status = 'cancelled';
    await tx.save();
  }

  return { tx, wallet: null, session };
};

const syncRecentPendingTopupsForUser = async (userId) => {
  const pendingTopups = await Transaction.find({
    user: userId,
    type: { $in: ['credit_pack_purchase', 'wallet_topup'] },
    status: 'pending',
    createdAt: { $gte: recentDate(2) },
    stripeCheckoutSessionId: { $exists: true, $ne: '' },
  })
    .sort({ createdAt: -1 })
    .limit(10);

  for (const tx of pendingTopups) {
    try {
      await syncTopupWithStripe({ tx });
    } catch (_e) {
      // Keep wallet endpoints resilient even if a single Stripe lookup fails.
    }
  }
};

// ===== User wallet =====
export const getCreditPacks = catchAsync(async (_req, res) => {
  return sendResponse(res, { data: await creditUsageSummary() });
});

export const getMyWallet = catchAsync(async (req, res) => {
  await syncRecentPendingTopupsForUser(req.user._id);

  const wallet = await Wallet.findOneAndUpdate(
    { user: req.user._id },
    { $setOnInsert: { user: req.user._id } },
    { new: true, upsert: true }
  );

  // determine plan label
  const sub = await UserSubscription.findOne({ user: req.user._id, status: 'active' }).populate('plan');

  const creditUsage = await creditUsageSummary();

  return sendResponse(res, {
    data: {
      wallet,
      activeSubscription: sub,
      creditPacks: creditUsage.packs,
      creditUsage
    }
  });
});

export const getMyTransactions = catchAsync(async (req, res) => {
  await syncRecentPendingTopupsForUser(req.user._id);

  const { skip, limit, page } = parsePagination(req.query);
  const filter = { $or: [{ user: req.user._id }, { advisor: req.user._id }] };
  if (req.query.type) filter.type = req.query.type;

  const total = await Transaction.countDocuments(filter);
  const items = await Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

// ===== Checkout for credit packs (Stripe or PayPal, no webhook flow) =====
export const createTopupCheckout = catchAsync(async (req, res) => {
  const { amount, credits, packId } = req.body;
  const provider = (req.body.provider || 'stripe').toLowerCase();
  const pack = await findCreditPack({ packId, credits: credits ?? amount });
  if (!pack) throw new ApiError(StatusCodes.BAD_REQUEST, 'Enter a valid credit amount');
  if (!['stripe', 'paypal'].includes(provider)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'provider must be "stripe" or "paypal"');
  }

  const country = detectCountry(req, { user: req.user });
  const local = await convertUsd(pack.priceUsd, country); // { currency, symbol, amount, ... }

  // create a pending transaction first
  const tx = await Transaction.create({
    type: 'credit_pack_purchase',
    status: 'pending',
    provider,
    user: req.user._id,
    amount: local.amount,
    currency: local.currency.toLowerCase(),
    country: local.country,
    amountUsd: pack.priceUsd,
    description: pack.isCustom ? `${pack.credits} custom credits` : `${pack.label} credit pack`,
    metadata: {
      packId: pack.id,
      credits: pack.credits,
      bonusCredits: pack.bonusCredits || 0,
      totalCredits: pack.totalCredits || pack.credits,
      priceUsd: pack.priceUsd,
      isCustom: pack.isCustom === true,
      creditUsdRate: pack.creditUsdRate
    }
  });

  // ---- PayPal branch ----
  if (provider === 'paypal') {
    if (!isPaypalConfigured()) throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'PayPal is not configured');
    const successBase =
      process.env.PAYPAL_WALLET_SUCCESS_URL ||
      `${process.env.SERVER_URL}/api/v1/wallet/paypal/success`;
    const cancelBase =
      process.env.PAYPAL_WALLET_CANCEL_URL ||
      `${process.env.SERVER_URL}/api/v1/wallet/paypal/cancel`;

    const order = await createPaypalOrder({
      amount: local.amount,
      currency: local.currency,
      description: pack.isCustom ? `${pack.credits} custom credits` : `${pack.label} credit pack`,
      referenceId: tx._id,
      returnUrl: `${successBase}?txId=${tx._id}`,
      cancelUrl: `${cancelBase}?txId=${tx._id}`
    });

    tx.paypalOrderId = order.orderId;
    await tx.save();

    return sendResponse(res, {
      data: {
        provider: 'paypal',
        checkoutUrl: order.approveUrl,
        orderId: order.orderId,
        txId: tx._id,
        currency: local.currency,
        amount: local.amount,
        amountUsd: pack.priceUsd,
        credits: pack.credits,
        bonusCredits: pack.bonusCredits || 0,
        totalCredits: pack.totalCredits || pack.credits,
        packId: pack.id,
        isCustom: pack.isCustom === true
      }
    });
  }

  // ---- Stripe branch ----
  const user = await User.findById(req.user._id);
  if (!user.stripeCustomerId) {
    const customer = await stripe.customers.create({ email: user.email, name: user.name });
    user.stripeCustomerId = customer.id;
    await user.save();
  }

  const successUrl = `${topupRedirectBase('success')}?txId=${tx._id}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${topupRedirectBase('cancel')}?txId=${tx._id}`;

  const checkout = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: user.stripeCustomerId,
    line_items: [
      {
        price_data: {
          currency: local.currency.toLowerCase(),
          unit_amount: toProviderMinorUnits(local.amount, local.currency),
          product_data: { name: pack.label }
        },
        quantity: 1
      }
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      type: 'credit_pack_purchase',
      userId: String(req.user._id),
      txId: String(tx._id),
      packId: pack.id,
      credits: String(pack.credits),
      bonusCredits: String(pack.bonusCredits || 0),
      totalCredits: String(pack.totalCredits || pack.credits),
      isCustom: String(pack.isCustom === true)
    }
  });

  tx.stripeCheckoutSessionId = checkout.id;
  await tx.save();

  return sendResponse(res, {
    data: {
      provider: 'stripe',
      checkoutUrl: checkout.url,
      sessionId: checkout.id,
      txId: tx._id,
      currency: local.currency,
      amount: local.amount,
      amountUsd: pack.priceUsd,
      credits: pack.credits,
      bonusCredits: pack.bonusCredits || 0,
      totalCredits: pack.totalCredits || pack.credits,
      packId: pack.id,
      isCustom: pack.isCustom === true
    }
  });
});

// ===== PayPal top-up success/cancel routes =====
export const paypalTopupSuccess = catchAsync(async (req, res) => {
  const txId = req.query.txId;
  const orderId = req.query.orderId || req.query.token;
  if (!txId) throw new ApiError(StatusCodes.BAD_REQUEST, 'Missing txId');

  const tx = await Transaction.findById(txId);
  if (!tx) throw new ApiError(StatusCodes.NOT_FOUND, 'Transaction not found');
  if (tx.status === 'completed') {
    const w = await Wallet.findOne({ user: tx.user });
    return sendResponse(res, { message: 'Already credited', data: { transaction: tx, wallet: w } });
  }

  const capture = await capturePaypalOrder(orderId || tx.paypalOrderId);
  if (!capture.paid) {
    return sendResponse(res, {
      statusCode: StatusCodes.PAYMENT_REQUIRED,
      success: false,
      message: 'Payment not completed yet'
    });
  }

  const credits = Number(tx.metadata?.totalCredits || tx.metadata?.credits || tx.amountUsd || 0);
  const wallet = await Wallet.findOneAndUpdate(
    { user: tx.user },
    { $inc: { balance: credits } },
    { new: true, upsert: true }
  );

  tx.status = 'completed';
  tx.paypalOrderId = tx.paypalOrderId || orderId;
  tx.paypalCaptureId = capture.captureId;
  await tx.save();

  return sendResponse(res, { message: 'Wallet credited', data: { transaction: tx, wallet } });
});

export const paypalTopupCancel = catchAsync(async (req, res) => {
  const { txId } = req.query;
  if (txId) await Transaction.findByIdAndUpdate(txId, { status: 'cancelled' });
  return sendResponse(res, { message: 'Top-up cancelled' });
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

  const { tx: syncedTx, wallet, session } = await syncTopupWithStripe({
    tx,
    sessionId: String(session_id),
  });

  if (!session || session.payment_status !== 'paid') {
    return sendResponse(res, {
      statusCode: StatusCodes.PAYMENT_REQUIRED,
      success: false,
      message: 'Payment not completed yet'
    });
  }

  return sendResponse(res, {
    message: 'Wallet credited',
    data: { transaction: syncedTx, wallet },
  });
});

export const stripeTopupCancel = catchAsync(async (req, res) => {
  const { txId } = req.query;
  if (txId) {
    await Transaction.findByIdAndUpdate(txId, { status: 'cancelled' });
  }
  return sendResponse(res, { message: 'Top-up cancelled' });
});

export const getTopupStatus = catchAsync(async (req, res) => {
  const txId = (req.query.txId || '').toString().trim();
  const sessionId =
    (req.query.sessionId || req.query.session_id || '').toString().trim();
  if (!txId) throw new ApiError(StatusCodes.BAD_REQUEST, 'txId is required');

  const tx = await Transaction.findOne({ _id: txId, user: req.user._id });
  if (!tx) throw new ApiError(StatusCodes.NOT_FOUND, 'Transaction not found');

  let wallet = await Wallet.findOne({ user: req.user._id });
  let syncedTx = tx;
  let session = null;

  if (tx.status !== 'completed' && (sessionId || tx.stripeCheckoutSessionId)) {
    const synced = await syncTopupWithStripe({ tx, sessionId });
    syncedTx = synced.tx;
    session = synced.session;
    wallet = synced.wallet || wallet;
  }

  if (!wallet) {
    wallet = await Wallet.findOneAndUpdate(
      { user: req.user._id },
      { $setOnInsert: { user: req.user._id } },
      { new: true, upsert: true },
    );
  }

  return sendResponse(res, {
    data: {
      txId: String(syncedTx._id),
      status: syncedTx.status,
      amount: syncedTx.amount || 0,
      walletBalance: wallet?.balance || 0,
      stripePaymentStatus: session?.payment_status || null,
    },
  });
});

// ===== Withdrawal =====
// Advisor requests a payout of `credits` from their earnings balance. Credits are
// held immediately; an admin then approves/sends the payout via Hyperwallet.
export const requestWithdrawal = catchAsync(async (req, res) => {
  if (req.user.role !== 'advisor') throw new ApiError(StatusCodes.FORBIDDEN, 'Advisors only');
  const credits = Number(req.body.credits ?? req.body.amount);

  const advisor = await User.findById(req.user._id);
  const tx = await createPayoutRequest({
    advisor,
    credits,
    initiatedBy: req.user._id,
    note: 'Advisor payout request',
    autoProcess: false
  });

  return sendResponse(res, { message: 'Withdrawal requested', data: tx });
});

// ===== Advisor self-service payout account (Hyperwallet) =====
export const getMyPayoutAccount = catchAsync(async (req, res) => {
  if (req.user.role !== 'advisor') throw new ApiError(StatusCodes.FORBIDDEN, 'Advisors only');
  const advisor = await User.findById(req.user._id).select(
    'name email dateOfBirth country state city hyperwallet'
  );
  const cfg = await getPayoutConfig();
  const wallet = await Wallet.findOne({ user: req.user._id }).select('earningsBalance pendingPayouts').lean();
  const available = Math.round(wallet?.earningsBalance || 0);
  return sendResponse(res, {
    data: {
      account: publicPayoutAccount(advisor),
      advisor: {
        dateOfBirth: advisor.dateOfBirth,
        country: advisor.country,
        state: advisor.state,
        city: advisor.city
      },
      config: { payoutCreditUsdRate: cfg.payoutCreditUsdRate, payoutCurrency: cfg.payoutCurrency, minPayoutCredits: cfg.minPayoutCredits },
      balance: { availableCredits: available, availableUsd: creditsToUsd(available, cfg) }
    }
  });
});

export const setupMyPayoutAccount = catchAsync(async (req, res) => {
  if (req.user.role !== 'advisor') throw new ApiError(StatusCodes.FORBIDDEN, 'Advisors only');
  const advisor = await User.findById(req.user._id);
  await ensureHyperwalletUser(advisor, req.body || {});
  return sendResponse(res, { message: 'Payout account ready', data: publicPayoutAccount(advisor) });
});

export const createMyPayoutDropInToken = catchAsync(async (req, res) => {
  if (req.user.role !== 'advisor') throw new ApiError(StatusCodes.FORBIDDEN, 'Advisors only');
  const advisor = await User.findById(req.user._id);
  if (!advisor?.hyperwallet?.userToken) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Create your Hyperwallet payout account first');
  }
  const authenticationToken = await createHyperwalletAuthenticationToken(advisor.hyperwallet.userToken);
  return sendResponse(res, {
    data: {
      userToken: advisor.hyperwallet.userToken,
      authenticationToken,
      widgetScriptUrl: getHyperwalletWidgetScriptUrl()
    }
  });
});

export const syncMyPayoutDropInMethod = catchAsync(async (req, res) => {
  if (req.user.role !== 'advisor') throw new ApiError(StatusCodes.FORBIDDEN, 'Advisors only');
  const advisor = await User.findById(req.user._id);
  await syncPayoutMethodFromHyperwallet(advisor);
  return sendResponse(res, { message: 'Payout method connected', data: publicPayoutAccount(advisor) });
});

export const removeMyPayoutMethod = catchAsync(async (req, res) => {
  if (req.user.role !== 'advisor') throw new ApiError(StatusCodes.FORBIDDEN, 'Advisors only');
  const advisor = await User.findById(req.user._id);
  await removePayoutMethod(advisor);
  return sendResponse(res, { message: 'Payout method removed', data: publicPayoutAccount(advisor) });
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
