import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Transaction from '../models/transaction.model.js';
import Session from '../models/session.model.js';
import Wallet from '../models/wallet.model.js';
import Currency from '../models/currency.model.js';
import Job from '../models/job.model.js';
import { listTipPacks } from './credit.service.js';
import { enqueueJob, registerJobHandler } from './jobQueue.service.js';
import { NOTIFICATION_BROADCAST_JOB } from './notificationJobs.service.js';
import { flutterwaveConfigured, flutterwaveRequest, flutterwaveTestMode, isAllowedFlutterwaveCheckoutUrl } from './flutterwaveProvider.service.js';

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const round2 = n => Math.round(Number(n) * 100) / 100;
const tips = ['tip', 'tip_fiat'];
export const flutterwaveTipsEnabled = () => process.env.FLUTTERWAVE_TIPS_ENABLED === 'true' &&
  flutterwaveConfigured();

const ngnRate = async () => {
  const ngn = await Currency.findOne({ country: 'NG', currency: 'NGN', isActive: true }).lean();
  const rate = Number(ngn?.usdRate);
  if (!Number.isFinite(rate) || rate <= 0) throw fail('Admin must configure the NGN/USD rate in Currencies', 503);
  return rate;
};
export const flutterwaveTipCatalog = async user => {
  if (!flutterwaveTipsEnabled(user)) return { enabled: false, currency: 'NGN', packs: [] };
  return { enabled: true, currency: 'NGN', packs: (await listTipPacks()).map(p => ({
    id: p.id, label: p.label, amountNgn: round2(p.flutterwavePriceNgn)
  })).filter(p => p.amountNgn > 0) };
};

export const createFlutterwaveTipCheckout = async ({ user, sessionId, packId, expectedAmountNgn, requestId }) => {
  if (!flutterwaveTipsEnabled(user)) throw fail('Flutterwave tips are currently unavailable', 503);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(String(requestId || ''))) throw fail('A tip request ID is required');
  const session = await Session.findById(sessionId);
  if (!session) throw fail('Session not found', 404);
  if (String(session.user) !== String(user._id)) throw fail('Only the user can tip', 403);
  if (session.status !== 'completed') throw fail('Tips are available after a completed session', 409);
  const requestKey = `tip:${user._id}:${requestId}`;
  const existing = await Transaction.findOne({ flutterwaveRequestKey: requestKey }).select('+flutterwaveCheckoutUrl');
  if (existing) {
    if (String(existing.session) !== String(sessionId) || existing.metadata?.packId !== packId) throw fail('This request belongs to another tip', 409);
    if (!existing.flutterwaveCheckoutUrl && existing.status === 'pending') throw fail('Checkout is being prepared. Please check your pending tip.', 409);
    return existing;
  }
  if (session.tipCount > 0 || await Transaction.exists({ session: sessionId, user: user._id,
    type: { $in: tips }, status: { $in: ['completed', 'refunded'] } })) throw fail('You have already tipped this session', 409);
  if (await Transaction.exists({ session: sessionId, user: user._id, type: 'tip_checkout', status: 'pending' })) {
    throw fail('A tip payment is pending. Check or cancel it before starting another.', 409);
  }
  const pack = (await listTipPacks()).find(p => p.id === packId);
  const amount = round2(pack?.flutterwavePriceNgn ?? 0);
  if (!pack || !Number.isFinite(amount) || amount <= 0) throw fail('This tip amount is not available with Flutterwave');
  if (Math.round(Number(expectedAmountNgn) * 100) !== Math.round(amount * 100)) {
    throw fail('The Naira price changed. Refresh the tip amounts before paying.', 409);
  }
  const rate = await ngnRate();
  let origin;
  try { origin = new URL(process.env.SERVER_URL || ''); } catch { throw fail('Configure SERVER_URL before using Flutterwave', 503); }
  if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) throw fail('Flutterwave requires a public HTTPS server URL', 503);
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid' && !hello.serviceId) throw fail('Flutterwave tips require a MongoDB replica set or Atlas', 503);
  await Transaction.init();
  const reference = `PP-TIP-${crypto.randomUUID()}`;
  let tx;
  try {
    tx = await Transaction.create({
      txCode: reference, type: 'tip_checkout', status: 'pending', provider: 'flutterwave',
      user: user._id, advisor: session.advisor, session: session._id, country: user.country || undefined,
      amount, currency: 'ngn', amountUsd: round2(amount / rate),
      flutterwaveReference: reference, flutterwaveRequestKey: requestKey,
      description: `Tip checkout for session ${session.sessionCode}`,
      metadata: { packId, ngnPerUsd: rate, isTest: flutterwaveTestMode() }
    });
  } catch (error) {
    if (error.code === 11000) throw fail('A tip payment is already being prepared. Check your pending tip.', 409);
    throw error;
  }
  await enqueueJob('flutterwave_tip_reconcile', { txId: String(tx._id) }, { delayMs: 60000, maxAttempts: 300 });
  const checkout = await flutterwaveRequest('/payments', { body: {
    tx_ref: reference, amount, currency: 'NGN',
    redirect_url: new URL('/api/v1/wallet/flutterwave/return', origin).toString(),
    customer: { email: user.email, name: user.name },
    customizations: { title: 'Prophetic Pathway Tip', description: `Optional tip for ${session.sessionCode}` },
    meta: { transactionId: String(tx._id) }
  } });
  if (!isAllowedFlutterwaveCheckoutUrl(checkout?.link)) throw fail('Flutterwave returned an invalid checkout URL', 502);
  tx.flutterwaveCheckoutUrl = new URL(checkout.link).toString();
  await tx.save();
  return tx;
};

export const validateFlutterwaveTip = (tx, payment) => {
  if (tx.provider !== 'flutterwave' || tx.type !== 'tip_checkout' ||
      String(payment?.tx_ref) !== tx.flutterwaveReference || tx.currency !== 'ngn' ||
      String(payment?.currency).toUpperCase() !== 'NGN') throw fail('Payment does not match this tip');
  if (payment.status !== 'successful') return false;
  if (!payment.id || !Number.isFinite(Number(payment.amount)) || Math.round(Number(payment.amount) * 100) !== Math.round(tx.amount * 100)) throw fail('Payment amount does not match this tip');
  if (!Number.isFinite(tx.metadata?.ngnPerUsd) || tx.metadata.ngnPerUsd <= 0) throw fail('Invalid tip conversion rate');
  return true;
};

export const fulfillFlutterwaveTip = async (tx, payment) => {
  if (!validateFlutterwaveTip(tx, payment)) return tx;
  const dbSession = await mongoose.startSession();
  let result;
  try {
    await dbSession.withTransaction(async () => {
      const claimed = await Transaction.findOneAndUpdate({ _id: tx._id, type: 'tip_checkout', provider: 'flutterwave',
        status: { $nin: ['completed', 'refunded'] } }, { $set: {
        status: 'completed', flutterwaveTransactionId: String(payment.id),
        'metadata.verifiedAt': new Date(), 'metadata.providerFeeNgn': Number(payment.app_fee || 0)
      } }, { returnDocument: 'after', session: dbSession });
      if (!claimed) { result = await Transaction.findById(tx._id).session(dbSession); return; }
      const session = await Session.findById(claimed.session).session(dbSession);
      const previous = await Transaction.exists({ session: claimed.session, type: { $in: tips }, status: { $in: ['completed', 'refunded'] } }).session(dbSession);
      if (!session || previous || session.tipCount > 0) {
        // A late payment can race an IAP purchase on another device. Keep its
        // money separate and queue a full refund instead of awarding two tips.
        await Transaction.updateOne({ _id: claimed._id }, { $set: { 'metadata.refundRequired': true } }, { session: dbSession });
        await Job.create([{ type: 'flutterwave_tip_duplicate_refund', payload: { txId: String(claimed._id) }, maxAttempts: 300 }], { session: dbSession });
        claimed.metadata.refundRequired = true;
        result = claimed;
        return;
      }
      const usd = round2(claimed.amount / claimed.metadata.ngnPerUsd);
      const revenue = { grossAmountUsd: usd, netProceedsUsd: usd, commissionAmountUsd: 0, taxAmountUsd: 0 };
      const [userTip] = await Transaction.create([{
        type: 'tip_fiat', status: 'completed', provider: 'flutterwave',
        user: claimed.user, advisor: claimed.advisor, session: claimed.session, sourceTransaction: claimed._id,
        amount: claimed.amount, currency: 'ngn', amountUsd: usd, ...revenue,
        description: `Tip for session ${session.sessionCode} via Flutterwave`,
        metadata: { ngnPerUsd: claimed.metadata.ngnPerUsd, providerFeeNgn: Number(payment.app_fee || 0) }
      }], { session: dbSession });
      await Transaction.create([{
        type: 'advisor_tip_fiat', status: 'completed', provider: 'flutterwave',
        user: claimed.user, advisor: claimed.advisor, session: claimed.session, sourceTransaction: userTip._id,
        amount: usd, currency: 'usd', amountUsd: usd, ...revenue,
        description: `Flutterwave tip received for session ${session.sessionCode}`
      }], { session: dbSession });
      // The platform absorbs provider fees: the full tip goes to the advisor.
      await Wallet.findOneAndUpdate({ user: claimed.advisor }, { $inc: {
        tipEarningsBalanceUsd: usd, totalTipEarnedUsd: usd
      }, $setOnInsert: { user: claimed.advisor } }, { upsert: true, session: dbSession });
      session.tipAmountFiatUsd = round2((session.tipAmountFiatUsd || 0) + usd);
      session.tipNetAmountFiatUsd = round2((session.tipNetAmountFiatUsd || 0) + usd);
      session.tipCount = (session.tipCount || 0) + 1;
      await session.save({ session: dbSession });
      await Job.create([{ type: NOTIFICATION_BROADCAST_JOB, payload: {
        recipientIds: [String(claimed.advisor)], type: 'tip_received', title: 'You received a tip',
        body: `You received USD ${usd.toFixed(2)} via Flutterwave`,
        data: { sessionId: String(claimed.session), transactionId: String(userTip._id) }
      } }], { session: dbSession });
      result = claimed;
    });
  } finally { await dbSession.endSession(); }
  return result;
};

export const syncFlutterwaveTip = async (tx, transactionId) => {
  if (['completed', 'refunded'].includes(tx.status)) return tx;
  const payment = await flutterwaveRequest(transactionId ? `/transactions/${encodeURIComponent(transactionId)}/verify`
    : `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(tx.flutterwaveReference)}`, { allowNotFound: true });
  return payment ? fulfillFlutterwaveTip(tx, payment) : tx;
};

export const applyFlutterwaveTipRefund = async ({ tx, payment, refund, refundId }) => {
  const amount = Number(refund.amount_refunded ?? refund.AmountRefunded);
  if (!Number.isFinite(amount) || amount <= 0 || String(refund.id) !== String(refundId) ||
      String(refund.transaction_id ?? refund.tx_id ?? refund.TransactionId) !== String(payment.id) ||
      !['completed', 'completed-mpgs', 'completed-bank-transfer', 'successful'].includes(String(refund.status).toLowerCase()) ||
      (refund.currency && String(refund.currency).toUpperCase() !== 'NGN')) throw fail('Invalid verified tip refund');
  tx = await fulfillFlutterwaveTip(tx, payment);
  if (tx?.status !== 'completed') throw fail('Original tip payment is not confirmed', 503);
  const dbSession = await mongoose.startSession();
  try {
    await dbSession.withTransaction(async () => {
      if (await Transaction.exists({ flutterwaveRefundId: String(refundId) }).session(dbSession)) return;
      const current = await Transaction.findById(tx._id).session(dbSession);
      const refunded = round2(Number(current.metadata.refundedNgn || 0) + amount);
      if (refunded > current.amount) throw fail('Refund exceeds the original tip');
      const usdTotal = round2(refunded / current.metadata.ngnPerUsd);
      const usd = round2(usdTotal - Number(current.metadata.refundedUsd || 0));
      await Transaction.create([{
        txCode: `FLW-TIP-REFUND-${refundId}`, type: 'tip_refund', status: 'completed', provider: 'flutterwave',
        user: current.user, advisor: current.advisor, session: current.session, sourceTransaction: current._id,
        amount, currency: 'ngn', amountUsd: usd, flutterwaveRefundId: String(refundId),
        description: 'Flutterwave tip refund'
      }], { session: dbSession });
      if (!current.metadata.refundRequired) {
        await Transaction.create([{
          type: 'advisor_tip_refund', status: 'completed', provider: 'flutterwave',
          user: current.user, advisor: current.advisor, session: current.session, sourceTransaction: current._id,
          amount: -usd, currency: 'usd', amountUsd: -usd, netProceedsUsd: -usd, grossAmountUsd: -usd,
          description: 'Flutterwave tip refund deducted from earnings'
        }], { session: dbSession });
        await Wallet.findOneAndUpdate({ user: current.advisor }, { $inc: { tipEarningsBalanceUsd: -usd, totalTipEarnedUsd: -usd } }, { session: dbSession });
        await Session.updateOne({ _id: current.session }, { $inc: { tipNetAmountFiatUsd: -usd } }, { session: dbSession });
      }
      await Transaction.updateOne({ _id: current._id }, { $set: {
        'metadata.refundedNgn': refunded, 'metadata.refundedUsd': usdTotal
      } }, { session: dbSession });
    });
  } finally { await dbSession.endSession(); }
};

export const refundDuplicateFlutterwaveTip = async ({ txId }) => {
    const tx = await Transaction.findById(txId);
    if (!tx?.metadata?.refundRequired || Number(tx.metadata.refundedNgn || 0) >= tx.amount) return;
    // Look up existing refunds before retrying a possibly timed-out POST.
    const from = new Date(tx.createdAt || Date.now() - 86400000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const refunds = await flutterwaveRequest(`/refunds?id=${encodeURIComponent(tx.flutterwaveTransactionId)}&from=${from}&to=${to}`);
    const existing = (Array.isArray(refunds) ? refunds : []).filter(r =>
      String(r.transaction_id ?? r.tx_id) === String(tx.flutterwaveTransactionId) &&
      !['failed', 'cancelled'].includes(String(r.status).toLowerCase()));
    const payment = await flutterwaveRequest(`/transactions/${encodeURIComponent(tx.flutterwaveTransactionId)}/verify`);
    for (const entry of existing) {
      const verified = await flutterwaveRequest(`/refunds/${encodeURIComponent(entry.id)}`);
      if (!['completed', 'completed-mpgs', 'completed-bank-transfer', 'successful'].includes(String(verified.status).toLowerCase())) throw new Error('Waiting for duplicate tip refund');
      await applyFlutterwaveTipRefund({ tx, payment, refund: verified, refundId: String(verified.id) });
    }
    const current = await Transaction.findById(txId);
    const remaining = round2(current.amount - Number(current.metadata.refundedNgn || 0));
    if (remaining <= 0) return;
    const refund = await flutterwaveRequest(`/transactions/${encodeURIComponent(tx.flutterwaveTransactionId)}/refund`, {
      body: { amount: remaining, comments: 'Duplicate session tip payment',
        callbackurl: new URL('/api/v1/webhooks/flutterwave/refunds', process.env.SERVER_URL).toString() }
    });
    const verified = await flutterwaveRequest(`/refunds/${encodeURIComponent(refund.id)}`);
    if (!['completed', 'completed-mpgs', 'completed-bank-transfer', 'successful'].includes(String(verified.status).toLowerCase())) throw new Error('Waiting for duplicate tip refund');
    await applyFlutterwaveTipRefund({ tx, payment, refund: verified, refundId: String(verified.id) });
};

export const registerFlutterwaveTipJobs = () => {
  registerJobHandler('flutterwave_tip_reconcile', async ({ txId }) => {
    const tx = await Transaction.findOne({ _id: txId, type: 'tip_checkout', provider: 'flutterwave' });
    if (!tx) return;
    if ((await syncFlutterwaveTip(tx)).status === 'pending') throw new Error('Waiting for tip payment confirmation');
  });
  registerJobHandler('flutterwave_tip_duplicate_refund', refundDuplicateFlutterwaveTip);
};
