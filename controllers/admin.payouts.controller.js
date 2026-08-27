import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import User from '../models/user.model.js';
import Wallet from '../models/wallet.model.js';
import Transaction from '../models/transaction.model.js';
import { getPlatformSettings } from '../models/platformSetting.model.js';
import { logAdminActivity } from '../services/activity.service.js';
import { getHyperwalletWidgetScriptUrl } from '../config/hyperwallet.js';
import {
  createHyperwalletAuthenticationToken,
  listTransferMethods
} from '../services/hyperwallet.service.js';
import {
  getPayoutConfig,
  creditsToUsd,
  ensureHyperwalletUser,
  removePayoutMethod,
  syncPayoutMethodFromHyperwallet,
  hasPayoutMethod,
  createPayoutRequest,
  executePayout,
  retryPayout,
  syncPayout,
  markPaidManually
} from '../services/payout.service.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const roundCredits = (n) => Math.round(Number(n) || 0);

const publicAccount = (advisor) => {
  const hw = advisor.hyperwallet || {};
  return {
    configured: Boolean(hw.userToken),
    userToken: hw.userToken || null,
    status: hw.status || null,
    hasMethod: Boolean(hw.transferMethodToken),
    methodType: hw.transferMethodType || null,
    methodLabel: hw.methodLabel || '',
    currency: hw.currency || 'USD',
    verified: Boolean(hw.verified)
  };
};

/* -------------------------------------------------------------------------- */
/* Payout configuration                                                       */
/* -------------------------------------------------------------------------- */

// GET /admin/payouts/config
export const getPayoutSettings = catchAsync(async (_req, res) => {
  const cfg = await getPayoutConfig();
  return sendResponse(res, { data: cfg });
});

// PATCH /admin/payouts/config
export const updatePayoutSettings = catchAsync(async (req, res) => {
  const settings = await getPlatformSettings();
  const p = settings.payout || (settings.payout = {});

  if (typeof req.body.payoutCreditUsdRate !== 'undefined') {
    const v = Number(req.body.payoutCreditUsdRate);
    if (!Number.isFinite(v) || v < 0) throw new ApiError(StatusCodes.BAD_REQUEST, 'payoutCreditUsdRate must be >= 0');
    p.payoutCreditUsdRate = v;
  }
  if (typeof req.body.payoutCurrency !== 'undefined') {
    const c = String(req.body.payoutCurrency || '').trim().toUpperCase();
    if (c.length !== 3) throw new ApiError(StatusCodes.BAD_REQUEST, 'payoutCurrency must be a 3-letter ISO code');
    p.payoutCurrency = c;
  }
  if (typeof req.body.minPayoutCredits !== 'undefined') {
    const v = Number(req.body.minPayoutCredits);
    if (!Number.isFinite(v) || v < 0) throw new ApiError(StatusCodes.BAD_REQUEST, 'minPayoutCredits must be >= 0');
    p.minPayoutCredits = v;
  }
  if (typeof req.body.hyperwalletEnabled !== 'undefined') {
    p.hyperwalletEnabled = Boolean(req.body.hyperwalletEnabled);
  }
  if (typeof req.body.provider !== 'undefined') {
    if (!['hyperwallet', 'manual'].includes(req.body.provider)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'provider must be "hyperwallet" or "manual"');
    }
    p.provider = req.body.provider;
  }

  settings.markModified('payout');
  await settings.save();
  await logAdminActivity({
    adminId: req.user?._id,
    action: 'payout.config.update',
    description: 'Updated payout configuration',
    targetType: 'settings'
  });
  return sendResponse(res, { message: 'Payout settings updated', data: await getPayoutConfig() });
});

/* -------------------------------------------------------------------------- */
/* Advisor payout accounts + available balances                              */
/* -------------------------------------------------------------------------- */

// GET /admin/payouts/accounts  — advisors with earnings + payout account status
export const listPayoutAccounts = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const cfg = await getPayoutConfig();

  const filter = { role: 'advisor' };
  if (req.query.q) {
    const q = String(req.query.q).trim();
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } }
    ];
  }
  if (req.query.configured === 'true') filter['hyperwallet.userToken'] = { $exists: true, $ne: null };
  if (req.query.hasMethod === 'true') filter['hyperwallet.transferMethodToken'] = { $exists: true, $ne: null };

  const total = await User.countDocuments(filter);
  const advisors = await User.find(filter)
    .select('name email profilePhoto country hyperwallet')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const ids = advisors.map((a) => a._id);
  const wallets = await Wallet.find({ user: { $in: ids } })
    .select('user earningsBalance pendingPayouts totalWithdrawn totalEarned tipEarningsBalanceUsd pendingTipPayoutUsd totalTipWithdrawnUsd totalTipEarnedUsd')
    .lean();
  const wMap = new Map(wallets.map((w) => [String(w.user), w]));

  const data = advisors.map((a) => {
    const w = wMap.get(String(a._id)) || {};
    const available = roundCredits(w.earningsBalance || 0);
    const pending = roundCredits(w.pendingPayouts || 0);
    const tipAvailableUsd = round2(w.tipEarningsBalanceUsd || 0);
    const pendingTipUsd = round2(w.pendingTipPayoutUsd || 0);
    const serviceAvailableUsd = creditsToUsd(available, cfg);
    const servicePendingUsd = creditsToUsd(pending, cfg);
    return {
      advisor: { _id: a._id, name: a.name, email: a.email, profilePhoto: a.profilePhoto, country: a.country },
      account: publicAccount(a),
      availableCredits: available,
      serviceAvailableUsd,
      tipAvailableUsd,
      availableUsd: round2(Math.max(0, serviceAvailableUsd + tipAvailableUsd)),
      pendingCredits: pending,
      servicePendingUsd,
      pendingTipUsd,
      pendingUsd: round2(servicePendingUsd + pendingTipUsd),
      totalWithdrawnCredits: roundCredits(w.totalWithdrawn || 0),
      totalEarnedCredits: roundCredits(w.totalEarned || 0),
      totalTipEarnedUsd: round2(w.totalTipEarnedUsd || 0),
      totalTipWithdrawnUsd: round2(w.totalTipWithdrawnUsd || 0)
    };
  });

  return sendResponse(res, { data, meta: buildMeta({ page, limit, total }) });
});

// GET /admin/payouts/accounts/:advisorId
export const getAdvisorPayoutAccount = catchAsync(async (req, res) => {
  const advisor = await User.findOne({ _id: req.params.advisorId, role: 'advisor' })
    .select('name email profilePhoto dateOfBirth country state city hyperwallet');
  if (!advisor) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor not found');

  const cfg = await getPayoutConfig();
  const wallet = await Wallet.findOne({ user: advisor._id })
    .select('earningsBalance pendingPayouts totalWithdrawn totalEarned tipEarningsBalanceUsd pendingTipPayoutUsd totalTipWithdrawnUsd totalTipEarnedUsd').lean();
  const available = roundCredits(wallet?.earningsBalance || 0);
  const pendingCredits = roundCredits(wallet?.pendingPayouts || 0);
  const serviceAvailableUsd = creditsToUsd(available, cfg);
  const servicePendingUsd = creditsToUsd(pendingCredits, cfg);
  const tipAvailableUsd = round2(wallet?.tipEarningsBalanceUsd || 0);
  const pendingTipUsd = round2(wallet?.pendingTipPayoutUsd || 0);

  // Pull live transfer methods from Hyperwallet when linked (non-fatal).
  let transferMethods = [];
  if (advisor.hyperwallet?.userToken) {
    try {
      const methods = await listTransferMethods(advisor.hyperwallet.userToken);
      transferMethods = methods.map((m) => ({
        token: m.token,
        type: m.type,
        status: m.status,
        currency: m.transferMethodCurrency,
        // Hyperwallet masks sensitive fields; only expose masked hints.
        detail: m.bankAccountId || m.email || ''
      }));
    } catch {
      transferMethods = [];
    }
  }

  const recent = await Transaction.find({ type: 'advisor_payout', advisor: advisor._id })
    .sort({ createdAt: -1 }).limit(10).lean();

  return sendResponse(res, {
    data: {
      advisor: {
        _id: advisor._id,
        name: advisor.name,
        email: advisor.email,
        profilePhoto: advisor.profilePhoto,
        country: advisor.country,
        state: advisor.state,
        city: advisor.city,
        dateOfBirth: advisor.dateOfBirth
      },
      account: publicAccount(advisor),
      transferMethods,
      balance: {
        availableCredits: available,
        serviceAvailableUsd,
        tipAvailableUsd,
        availableUsd: round2(Math.max(0, serviceAvailableUsd + tipAvailableUsd)),
        pendingCredits,
        servicePendingUsd,
        pendingTipUsd,
        pendingUsd: round2(servicePendingUsd + pendingTipUsd),
        totalWithdrawnCredits: roundCredits(wallet?.totalWithdrawn || 0),
        totalTipEarnedUsd: round2(wallet?.totalTipEarnedUsd || 0),
        totalTipWithdrawnUsd: round2(wallet?.totalTipWithdrawnUsd || 0)
      },
      config: cfg,
      recentPayouts: recent
    }
  });
});

// POST /admin/payouts/accounts/:advisorId/setup  — create the Hyperwallet user
export const setupAdvisorAccount = catchAsync(async (req, res) => {
  const advisor = await User.findOne({ _id: req.params.advisorId, role: 'advisor' });
  if (!advisor) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor not found');
  await ensureHyperwalletUser(advisor, req.body || {});
  await logAdminActivity({
    adminId: req.user?._id,
    action: 'payout.account.setup',
    description: `Created Hyperwallet payee for ${advisor.name}`,
    targetType: 'advisor',
    targetUser: advisor._id
  });
  return sendResponse(res, { message: 'Payout account created', data: publicAccount(advisor) });
});

// POST /admin/payouts/accounts/:advisorId/drop-in-token
export const createAdvisorDropInToken = catchAsync(async (req, res) => {
  const advisor = await User.findOne({ _id: req.params.advisorId, role: 'advisor' });
  if (!advisor) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor not found');
  if (!advisor.hyperwallet?.userToken) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Create the Hyperwallet payout account first');
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

// POST /admin/payouts/accounts/:advisorId/sync-method
export const syncAdvisorDropInMethod = catchAsync(async (req, res) => {
  const advisor = await User.findOne({ _id: req.params.advisorId, role: 'advisor' });
  if (!advisor) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor not found');
  await syncPayoutMethodFromHyperwallet(advisor);
  return sendResponse(res, { message: 'Payout method connected', data: publicAccount(advisor) });
});

// DELETE /admin/payouts/accounts/:advisorId/method
export const removeAdvisorMethod = catchAsync(async (req, res) => {
  const advisor = await User.findOne({ _id: req.params.advisorId, role: 'advisor' });
  if (!advisor) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor not found');
  await removePayoutMethod(advisor);
  return sendResponse(res, { message: 'Payout method removed', data: publicAccount(advisor) });
});

/* -------------------------------------------------------------------------- */
/* Initiating + managing payouts                                              */
/* -------------------------------------------------------------------------- */

// POST /admin/payouts  — admin initiates a payout to an advisor (based on credits)
export const createPayout = catchAsync(async (req, res) => {
  const { advisorId, note } = req.body;
  const process = req.body.process !== false; // default: send immediately
  const advisor = await User.findOne({ _id: advisorId, role: 'advisor' });
  if (!advisor) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor not found');

  const cfg = await getPayoutConfig();
  const amountUsd = round2(req.body.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Provide a positive amountUsd value');
  }

  if (process && !hasPayoutMethod(advisor)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Advisor has no payout method. Add a bank/PayPal method first, or create without processing.');
  }

  const tx = await createPayoutRequest({
    advisor,
    amountUsd,
    initiatedBy: req.user?._id,
    note,
    autoProcess: process && cfg.hyperwalletEnabled
  });

  await logAdminActivity({
    adminId: req.user?._id,
    action: 'payout.create',
    description: `Initiated USD ${amountUsd.toFixed(2)} payout to ${advisor.name}`,
    targetType: 'payout',
    targetUser: advisor._id
  });

  return sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: process ? 'Payout initiated' : 'Payout queued',
    data: tx
  });
});

const loadPayout = async (id) => {
  const tx = await Transaction.findById(id);
  if (!tx || tx.type !== 'advisor_payout') throw new ApiError(StatusCodes.NOT_FOUND, 'Payout not found');
  return tx;
};

// POST /admin/payouts/:id/process  — send a queued/requested payout to Hyperwallet
export const processPayout = catchAsync(async (req, res) => {
  const tx = await loadPayout(req.params.id);
  const updated = await executePayout(tx);
  await logAdminActivity({
    adminId: req.user?._id,
    action: 'payout.process',
    description: `Processed payout ${tx.txCode || tx._id} via Hyperwallet`,
    targetType: 'payout',
    targetUser: tx.advisor
  });
  return sendResponse(res, { message: 'Payout sent to Hyperwallet', data: updated });
});

// POST /admin/payouts/:id/retry  — re-send a failed payout
export const retryPayoutCtrl = catchAsync(async (req, res) => {
  const tx = await loadPayout(req.params.id);
  const updated = await retryPayout(tx);
  return sendResponse(res, { message: 'Payout retried', data: updated });
});

// POST /admin/payouts/:id/sync  — reconcile against Hyperwallet
export const syncPayoutCtrl = catchAsync(async (req, res) => {
  const tx = await loadPayout(req.params.id);
  const updated = await syncPayout(tx);
  return sendResponse(res, { message: 'Payout synced', data: updated });
});

// POST /admin/payouts/:id/mark-paid  — manual out-of-band completion (fallback)
export const markPayoutPaid = catchAsync(async (req, res) => {
  const tx = await loadPayout(req.params.id);
  if (!['requested', 'approved', 'processing'].includes(tx.withdrawalStatus)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Only pending/processing payouts can be marked paid');
  }
  const updated = await markPaidManually(tx, req.user?._id);
  await logAdminActivity({
    adminId: req.user?._id,
    action: 'payout.mark_paid',
    description: `Manually marked payout ${tx.txCode || tx._id} as paid`,
    targetType: 'payout',
    targetUser: tx.advisor
  });
  return sendResponse(res, { message: 'Payout marked as paid', data: updated });
});

/* -------------------------------------------------------------------------- */
/* Stats                                                                      */
/* -------------------------------------------------------------------------- */

// GET /admin/payouts/stats
export const payoutStats = catchAsync(async (_req, res) => {
  const cfg = await getPayoutConfig();
  const agg = await Transaction.aggregate([
    { $match: { type: 'advisor_payout' } },
    {
      $group: {
        _id: '$withdrawalStatus',
        credits: { $sum: { $ifNull: ['$payoutCredits', '$amount'] } },
        tipUsd: { $sum: { $ifNull: ['$payoutTipUsd', 0] } },
        usd: { $sum: '$amountUsd' },
        count: { $sum: 1 }
      }
    }
  ]);
  const byStatus = Object.fromEntries(
    agg.map((a) => [a._id || 'unknown', {
      credits: roundCredits(a.credits),
      tipUsd: round2(a.tipUsd),
      usd: round2(a.usd),
      count: a.count
    }])
  );
  const empty = { credits: 0, tipUsd: 0, usd: 0, count: 0 };

  // Total unpaid advisor earnings still sitting in wallets (payable pool).
  const walletAgg = await Wallet.aggregate([
    {
      $group: {
        _id: null,
        earnings: { $sum: '$earningsBalance' },
        pending: { $sum: '$pendingPayouts' },
        tipUsd: { $sum: '$tipEarningsBalanceUsd' },
        pendingTipUsd: { $sum: '$pendingTipPayoutUsd' }
      }
    }
  ]);
  const payableCredits = roundCredits(walletAgg[0]?.earnings || 0);

  return sendResponse(res, {
    data: {
      config: cfg,
      requested: byStatus.requested || empty,
      processing: byStatus.processing || empty,
      paid: byStatus.paid || empty,
      failed: byStatus.failed || empty,
      rejected: byStatus.rejected || empty,
      payable: {
        credits: payableCredits,
        tipUsd: round2(walletAgg[0]?.tipUsd || 0),
        usd: round2(
          Math.max(0, creditsToUsd(payableCredits, cfg) + (walletAgg[0]?.tipUsd || 0))
        ),
        pendingCredits: roundCredits(walletAgg[0]?.pending || 0),
        pendingTipUsd: round2(walletAgg[0]?.pendingTipUsd || 0)
      }
    }
  });
});
