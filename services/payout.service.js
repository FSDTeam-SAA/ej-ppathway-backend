import Wallet from '../models/wallet.model.js';
import Transaction from '../models/transaction.model.js';
import User from '../models/user.model.js';
import { getPlatformSettings } from '../models/platformSetting.model.js';
import { isHyperwalletConfigured } from '../config/hyperwallet.js';
import {
  createHyperwalletUser,
  findHyperwalletUserByClientId,
  listTransferMethods,
  deactivateBankAccount,
  deactivatePaypalAccount,
  createPayment,
  getPayment,
  mapPaymentStatus
} from './hyperwallet.service.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const roundCredits = (n) => Math.round(Number(n) || 0);

// Held payout states — credits are sitting in wallet.pendingPayouts.
const HELD_STATUSES = ['requested', 'approved', 'processing'];

/* -------------------------------------------------------------------------- */
/* Config + credit⇄USD valuation                                              */
/* -------------------------------------------------------------------------- */

export const getPayoutConfig = async () => {
  const settings = await getPlatformSettings();
  const p = settings.payout || {};
  return {
    provider: p.provider || 'hyperwallet',
    hyperwalletEnabled: Boolean(p.hyperwalletEnabled),
    hyperwalletConfigured: isHyperwalletConfigured(),
    payoutCreditUsdRate: Number(p.payoutCreditUsdRate ?? settings.creditUsdRate ?? 1),
    payoutCurrency: (p.payoutCurrency || 'USD').toUpperCase(),
    minPayoutCredits: Number(p.minPayoutCredits ?? settings.minWithdrawal ?? 50)
  };
};

export const creditsToUsd = (credits, cfg) => round2((Number(credits) || 0) * Number(cfg.payoutCreditUsdRate || 0));

/* -------------------------------------------------------------------------- */
/* Advisor payout account (Hyperwallet user + transfer method)                */
/* -------------------------------------------------------------------------- */

const methodLabel = (method) => {
  const type = String(method?.type || '').toUpperCase();
  if (type === 'PAYPAL_ACCOUNT') return `PayPal ${method.email || ''}`.trim();
  const masked = method?.bankAccountId || method?.cardNumber || '';
  const institution = method?.bankName || (type === 'WIRE_ACCOUNT' ? 'Wire account' : 'Bank');
  return `${institution}${masked ? ` ${masked}` : ''}`.trim();
};

const localMethodType = (method) =>
  String(method?.type || '').toUpperCase() === 'PAYPAL_ACCOUNT' ? 'paypal' : 'bank_account';

/** Create (or re-link) the Hyperwallet user (payee) for an advisor. Idempotent. */
export const ensureHyperwalletUser = async (advisor, extra = {}) => {
  if (advisor.hyperwallet?.userToken) return advisor;

  // Re-link if a user with this clientUserId already exists on Hyperwallet.
  let hwUser = await findHyperwalletUserByClientId(advisor._id);
  if (!hwUser) hwUser = await createHyperwalletUser(advisor, extra);

  advisor.hyperwallet = {
    ...(advisor.hyperwallet?.toObject?.() || advisor.hyperwallet || {}),
    userToken: hwUser.token,
    programToken: hwUser.programToken,
    status: hwUser.status,
    createdAt: advisor.hyperwallet?.createdAt || new Date(),
    updatedAt: new Date()
  };
  await advisor.save();
  return advisor;
};

/** Persist the transfer method created inside Hyperwallet's secure Drop-in UI. */
export const syncPayoutMethodFromHyperwallet = async (advisor) => {
  if (!advisor.hyperwallet?.userToken) {
    throw Object.assign(new Error('Create the Hyperwallet payout account first'), { statusCode: 400 });
  }

  const methods = await listTransferMethods(advisor.hyperwallet.userToken);
  const usable = methods
    .filter(
      (method) => !['DE_ACTIVATED', 'FAILED'].includes(String(method.status || '').toUpperCase())
    )
    .sort((a, b) => new Date(b.createdOn || 0).getTime() - new Date(a.createdOn || 0).getTime());
  const method =
    usable.find((item) => String(item.status || '').toUpperCase() === 'ACTIVATED') ||
    usable.find((item) => item.isDefaultTransferMethod === true) ||
    usable[0];

  if (!method?.token) {
    throw Object.assign(new Error('No active payout method was found in Hyperwallet'), { statusCode: 400 });
  }

  advisor.hyperwallet.transferMethodToken = method.token;
  advisor.hyperwallet.transferMethodType = localMethodType(method);
  advisor.hyperwallet.methodLabel = methodLabel(method);
  advisor.hyperwallet.currency = (method.transferMethodCurrency || 'USD').toUpperCase();
  advisor.hyperwallet.verified = String(method.status || '').toUpperCase() === 'ACTIVATED';
  advisor.hyperwallet.updatedAt = new Date();
  await advisor.save();
  return method;
};

/** Remove the advisor's active transfer method (deactivate on Hyperwallet + clear locally). */
export const removePayoutMethod = async (advisor) => {
  const hw = advisor.hyperwallet;
  if (!hw?.userToken || !hw?.transferMethodToken) return advisor;
  try {
    if (hw.transferMethodType === 'paypal') {
      await deactivatePaypalAccount(hw.userToken, hw.transferMethodToken);
    } else {
      await deactivateBankAccount(hw.userToken, hw.transferMethodToken);
    }
  } catch {
    // Even if the remote deactivate fails we clear the local pointer so the
    // stale method is not used for future payouts.
  }
  advisor.hyperwallet.transferMethodToken = undefined;
  advisor.hyperwallet.transferMethodType = null;
  advisor.hyperwallet.methodLabel = '';
  advisor.hyperwallet.verified = false;
  advisor.hyperwallet.updatedAt = new Date();
  await advisor.save();
  return advisor;
};

export const hasPayoutMethod = (advisor) =>
  Boolean(advisor?.hyperwallet?.userToken && advisor?.hyperwallet?.transferMethodToken);

/* -------------------------------------------------------------------------- */
/* Wallet holds (credits)                                                     */
/* -------------------------------------------------------------------------- */

/** Atomically move `credits` from earningsBalance → pendingPayouts (guards sufficiency). */
const holdEarnings = async (advisorId, credits) => {
  const c = roundCredits(credits);
  const wallet = await Wallet.findOneAndUpdate(
    { user: advisorId, earningsBalance: { $gte: c } },
    { $inc: { earningsBalance: -c, pendingPayouts: c } },
    { new: true }
  );
  return wallet; // null → insufficient balance
};

/* -------------------------------------------------------------------------- */
/* Payout lifecycle                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Create a payout request: hold the advisor's credits and open a pending
 * advisor_payout transaction. Used by both the admin (initiate) and advisor
 * (self withdraw) flows. Does NOT contact Hyperwallet yet.
 *
 * @returns {Promise<Transaction>}
 */
export const createPayoutRequest = async ({ advisor, credits, initiatedBy, note, autoProcess = false }) => {
  const cfg = await getPayoutConfig();
  const c = roundCredits(credits);
  if (!Number.isFinite(c) || c <= 0) {
    throw Object.assign(new Error('Enter a valid credit amount'), { statusCode: 400 });
  }
  if (c < cfg.minPayoutCredits) {
    throw Object.assign(new Error(`Minimum payout is ${cfg.minPayoutCredits} credits`), { statusCode: 400 });
  }

  const wallet = await holdEarnings(advisor._id, c);
  if (!wallet) {
    throw Object.assign(new Error('Insufficient earnings balance'), { statusCode: 402 });
  }

  const amountUsd = creditsToUsd(c, cfg);
  const methodType = advisor.hyperwallet?.transferMethodType;
  const tx = await Transaction.create({
    type: 'advisor_payout',
    status: 'pending',
    provider: 'hyperwallet',
    advisor: advisor._id,
    amount: c,                       // credits held (wallet math is in credits)
    currency: cfg.payoutCurrency.toLowerCase(),
    amountUsd,
    payoutCredits: c,
    payoutRateUsd: cfg.payoutCreditUsdRate,
    description: note || 'Advisor payout',
    withdrawalMethod: methodType ? `hyperwallet_${methodType === 'paypal' ? 'paypal' : 'bank'}` : 'hyperwallet',
    withdrawalStatus: 'requested',
    withdrawalRequestedAt: new Date(),
    hyperwalletUserToken: advisor.hyperwallet?.userToken,
    metadata: { initiatedBy: initiatedBy ? String(initiatedBy) : undefined }
  });

  if (autoProcess) {
    return executePayout(tx, advisor);
  }
  return tx;
};

/**
 * Send an existing (held) payout to Hyperwallet. Transitions requested/approved
 * → processing, then applies the immediately-returned status (sandbox can return
 * COMPLETED synchronously).
 */
export const executePayout = async (tx, advisorArg) => {
  if (!isHyperwalletConfigured()) {
    throw Object.assign(new Error('Hyperwallet is not configured'), { statusCode: 503 });
  }
  const cfg = await getPayoutConfig();
  if (!cfg.hyperwalletEnabled) {
    throw Object.assign(new Error('Hyperwallet payouts are disabled in settings'), { statusCode: 400 });
  }
  if (!HELD_STATUSES.includes(tx.withdrawalStatus)) {
    throw Object.assign(new Error(`Payout is not in a sendable state (${tx.withdrawalStatus})`), { statusCode: 400 });
  }

  const advisor = advisorArg || (await User.findById(tx.advisor));
  if (!hasPayoutMethod(advisor)) {
    throw Object.assign(new Error('Advisor has no Hyperwallet payout method'), { statusCode: 400 });
  }

  // Ensure USD figure + payout metadata exist (legacy / advisor-requested txns
  // may have been created before the payout fields were populated).
  const credits = roundCredits(tx.payoutCredits ?? tx.amount);
  const amountUsd = tx.amountUsd && tx.amountUsd > 0 ? tx.amountUsd : creditsToUsd(credits, cfg);

  // Mark processing before the network call so retries are idempotent.
  tx.withdrawalStatus = 'processing';
  tx.withdrawalProcessedAt = new Date();
  tx.provider = 'hyperwallet';
  tx.payoutCredits = credits;
  tx.payoutRateUsd = tx.payoutRateUsd ?? cfg.payoutCreditUsdRate;
  tx.amountUsd = amountUsd;
  tx.withdrawalMethod = `hyperwallet_${advisor.hyperwallet.transferMethodType === 'paypal' ? 'paypal' : 'bank'}`;
  tx.hyperwalletUserToken = advisor.hyperwallet.userToken;
  await tx.save();

  let payment;
  try {
    payment = await createPayment({
      destinationToken: advisor.hyperwallet.transferMethodToken,
      amount: amountUsd,
      currency: (tx.currency || 'usd').toUpperCase(),
      clientPaymentId: String(tx._id),
      notes: tx.description || `Payout ${tx.txCode || tx._id}`
    });
  } catch (err) {
    // Could not even create the payment — return the held funds.
    await finalizeFailed(tx, err.message || 'Hyperwallet payment creation failed');
    throw Object.assign(new Error(err.message || 'Hyperwallet payment failed'), { statusCode: 502 });
  }

  tx.hyperwalletPaymentToken = payment.token;
  tx.hyperwalletStatus = payment.status;
  await tx.save();

  const mapped = mapPaymentStatus(payment.status);
  if (mapped === 'completed') return finalizePaid(tx, payment.status);
  if (mapped === 'failed') return finalizeFailed(tx, `Hyperwallet payment ${payment.status}`);
  return tx; // still processing — a webhook / sync will finalize
};

/** Idempotently finalize a held payout as paid. */
export const finalizePaid = async (txOrId, rawStatus) => {
  const id = txOrId._id || txOrId;
  const tx = await Transaction.findOneAndUpdate(
    { _id: id, withdrawalStatus: { $in: HELD_STATUSES } },
    {
      $set: {
        withdrawalStatus: 'paid',
        status: 'completed',
        withdrawalPaidAt: new Date(),
        hyperwalletStatus: rawStatus || 'COMPLETED'
      }
    },
    { new: true }
  );
  if (!tx) return Transaction.findById(id); // already finalized / not held
  const credits = roundCredits(tx.payoutCredits ?? tx.amount);
  await Wallet.updateOne(
    { user: tx.advisor },
    { $inc: { pendingPayouts: -credits, totalWithdrawn: credits } }
  );
  return tx;
};

/** Idempotently finalize a held payout as failed, returning credits to earnings. */
export const finalizeFailed = async (txOrId, reason) => {
  const id = txOrId._id || txOrId;
  const tx = await Transaction.findOneAndUpdate(
    { _id: id, withdrawalStatus: { $in: HELD_STATUSES } },
    {
      $set: {
        withdrawalStatus: 'failed',
        status: 'failed',
        withdrawalFailureReason: (reason || 'Payout failed').slice(0, 500),
        hyperwalletStatus: reason ? undefined : 'FAILED'
      }
    },
    { new: true }
  );
  if (!tx) return Transaction.findById(id);
  const credits = roundCredits(tx.payoutCredits ?? tx.amount);
  await Wallet.updateOne(
    { user: tx.advisor },
    { $inc: { pendingPayouts: -credits, earningsBalance: credits } }
  );
  return tx;
};

/**
 * Reject a still-held payout (admin action, no money sent). Returns credits.
 */
export const rejectPayout = async (tx, reason, adminId) => {
  const updated = await Transaction.findOneAndUpdate(
    { _id: tx._id, withdrawalStatus: { $in: ['requested', 'approved'] } },
    {
      $set: {
        withdrawalStatus: 'rejected',
        status: 'cancelled',
        withdrawalRejectedReason: reason || '',
        withdrawalApprovedBy: adminId || undefined
      }
    },
    { new: true }
  );
  if (!updated) {
    throw Object.assign(new Error('Payout is not in a rejectable state'), { statusCode: 400 });
  }
  const credits = roundCredits(updated.payoutCredits ?? updated.amount);
  await Wallet.updateOne(
    { user: updated.advisor },
    { $inc: { pendingPayouts: -credits, earningsBalance: credits } }
  );
  return updated;
};

/**
 * Manually mark a held payout as paid without Hyperwallet (fallback for
 * out-of-band transfers). Same wallet movement as a real completion.
 */
export const markPaidManually = async (tx, adminId) => {
  const paid = await finalizePaid(tx, 'MANUAL');
  if (paid && String(paid.withdrawalMethod || '').startsWith('hyperwallet')) {
    paid.withdrawalMethod = 'manual';
    paid.withdrawalApprovedBy = adminId || paid.withdrawalApprovedBy;
    await paid.save();
  }
  return paid;
};

/** Re-hold a failed payout's credits and resend it to Hyperwallet. */
export const retryPayout = async (tx) => {
  if (tx.withdrawalStatus !== 'failed') {
    throw Object.assign(new Error('Only failed payouts can be retried'), { statusCode: 400 });
  }
  const advisor = await User.findById(tx.advisor);
  if (!hasPayoutMethod(advisor)) {
    throw Object.assign(new Error('Advisor has no Hyperwallet payout method'), { statusCode: 400 });
  }
  const credits = roundCredits(tx.payoutCredits ?? tx.amount);
  const wallet = await holdEarnings(tx.advisor, credits);
  if (!wallet) {
    throw Object.assign(new Error('Insufficient earnings balance to retry'), { statusCode: 402 });
  }
  tx.withdrawalStatus = 'requested';
  tx.status = 'pending';
  tx.withdrawalFailureReason = undefined;
  await tx.save();
  return executePayout(tx, advisor);
};

/**
 * Reconcile a processing payout against Hyperwallet's current payment status.
 * Safe to call repeatedly (finalizers are idempotent).
 */
export const syncPayout = async (tx) => {
  if (!tx.hyperwalletPaymentToken) return tx;
  if (!['processing', 'requested', 'approved'].includes(tx.withdrawalStatus)) return tx;
  const payment = await getPayment(tx.hyperwalletPaymentToken);
  const mapped = mapPaymentStatus(payment.status);
  if (mapped === 'completed') return finalizePaid(tx, payment.status);
  if (mapped === 'failed') return finalizeFailed(tx, `Hyperwallet payment ${payment.status}`);
  tx.hyperwalletStatus = payment.status;
  await tx.save();
  return tx;
};

/**
 * Apply a Hyperwallet PAYMENTS webhook notification to the matching payout.
 * @param {object} payment  the `object` field of the notification (a payment)
 */
export const applyPaymentWebhook = async (payment) => {
  if (!payment) return null;
  const or = [];
  if (payment.token) or.push({ hyperwalletPaymentToken: payment.token });
  if (isValidObjectId(payment.clientPaymentId)) or.push({ _id: payment.clientPaymentId });
  if (or.length === 0) return null;
  const tx = await Transaction.findOne({ type: 'advisor_payout', $or: or });
  if (!tx) return null;
  if (!tx.hyperwalletPaymentToken && payment.token) {
    tx.hyperwalletPaymentToken = payment.token;
    await tx.save();
  }
  const mapped = mapPaymentStatus(payment.status);
  if (mapped === 'completed') return finalizePaid(tx, payment.status);
  if (mapped === 'failed') return finalizeFailed(tx, `Hyperwallet payment ${payment.status}`);
  tx.hyperwalletStatus = payment.status;
  await tx.save();
  return tx;
};

const isValidObjectId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);
