import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Transaction from '../models/transaction.model.js';
import Wallet from '../models/wallet.model.js';
import Currency from '../models/currency.model.js';
import { listCreditPacks } from './credit.service.js';
import { enqueueJob, registerJobHandler } from './jobQueue.service.js';
import { flutterwaveConfigured, flutterwaveEnabled, flutterwaveTestMode, flutterwaveRequest, flutterwaveSecretMatches, isAllowedFlutterwaveCheckoutUrl } from './flutterwaveProvider.service.js';
export { flutterwaveConfigured, flutterwaveEnabled, flutterwaveRequest, flutterwaveSecretMatches, isAllowedFlutterwaveCheckoutUrl };
import { fulfillFlutterwaveTip, applyFlutterwaveTipRefund, registerFlutterwaveTipJobs } from './flutterwaveTip.service.js';

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const isTestMode = flutterwaveTestMode;
const round2 = (n) => Math.round(n * 100) / 100;

export const validateFlutterwavePayment = (tx, payment) => {
  if (tx.provider !== 'flutterwave' || tx.type !== 'credit_pack_purchase' ||
      String(payment?.tx_ref) !== tx.flutterwaveReference ||
      String(payment?.currency).toUpperCase() !== 'NGN' || tx.currency !== 'ngn') {
    throw fail('Payment does not match this credit purchase');
  }
  if (payment.status !== 'successful') return false;
  if (!payment.id || !Number.isFinite(Number(payment.amount)) ||
      Math.round(Number(payment.amount) * 100) !== Math.round(tx.amount * 100)) {
    throw fail('Payment amount does not match this credit purchase');
  }
  const credits = Number(tx.metadata?.totalCredits);
  if (!Number.isSafeInteger(credits) || credits <= 0) throw fail('Invalid purchased credits');
  return true;
};

// One MongoDB transaction commits both the receipt and the balance. A failed
// write rolls everything back; concurrent callbacks/webhooks retry safely.
export const fulfillFlutterwaveCredits = async (tx, payment) => {
  if (!validateFlutterwavePayment(tx, payment)) return tx;
  const dbSession = await mongoose.startSession();
  let result;
  try {
    await dbSession.withTransaction(async () => {
      const claimed = await Transaction.findOneAndUpdate(
        { _id: tx._id, provider: 'flutterwave', type: 'credit_pack_purchase', status: { $nin: ['completed', 'refunded'] } },
        { $set: {
          status: 'completed', flutterwaveTransactionId: String(payment.id),
          'metadata.paymentType': payment.payment_type,
          'metadata.flutterwaveReference': payment.flw_ref,
          'metadata.verifiedAt': new Date(),
          'metadata.providerFeeNgn': Number(payment.app_fee || 0)
        } },
        { returnDocument: 'after', session: dbSession }
      );
      if (!claimed) {
        result = await Transaction.findById(tx._id).session(dbSession);
        return;
      }
      await Wallet.findOneAndUpdate(
        { user: claimed.user },
        { $inc: { balance: Number(claimed.metadata.totalCredits) }, $setOnInsert: { user: claimed.user } },
        { upsert: true, session: dbSession }
      );
      result = claimed;
    });
  } finally {
    await dbSession.endSession();
  }
  return result;
};

export const syncFlutterwavePurchase = async (tx, transactionId) => {
  if (['completed', 'refunded'].includes(tx.status)) return tx;
  const payment = await flutterwaveRequest(transactionId
    ? `/transactions/${encodeURIComponent(transactionId)}/verify`
    : `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(tx.flutterwaveReference)}`,
  { allowNotFound: true });
  if (!payment) return tx;
  if (tx.type === 'tip_checkout') return fulfillFlutterwaveTip(tx, payment);
  if (validateFlutterwavePayment(tx, payment)) return fulfillFlutterwaveCredits(tx, payment);
  // A failed card attempt does not close the hosted checkout. A subsequent
  // successful attempt can still fulfill this same reference.
  return tx;
};

export const cancelFlutterwaveCheckout = async (tx) => {
  const synced = await syncFlutterwavePurchase(tx);
  if (synced.status === 'completed') return synced;
  if (tx.flutterwaveCheckoutUrl) await flutterwaveRequest('/payments/link/disable', {
    body: { link: tx.flutterwaveCheckoutUrl }, allowInactiveLink: true
  });
  // A payment already in flight can still be fulfilled by its verified webhook.
  // Never overwrite a concurrently completed purchase with "cancelled".
  return await Transaction.findOneAndUpdate(
    { _id: tx._id, status: 'pending', provider: 'flutterwave' },
    { $set: { status: 'cancelled', 'metadata.cancelledAt': new Date() } },
    { returnDocument: 'after' }
  ) || await Transaction.findById(tx._id);
};

// Refunds are separate receipts. Keep the original sale for gross sales/counts
// and subtract cash refunds in net reports. Replays cannot remove credits twice.
export const applyFlutterwaveCreditRefund = async (refundId) => {
  const refund = await flutterwaveRequest(`/refunds/${encodeURIComponent(refundId)}`);
  if (!['completed', 'completed-mpgs', 'completed-bank-transfer', 'successful'].includes(String(refund?.status).toLowerCase())) return;
  const paymentId = String(refund.transaction_id ?? refund.tx_id ?? refund.TransactionId ?? '');
  const amount = Number(refund.amount_refunded ?? refund.AmountRefunded);
  if (!paymentId || !Number.isFinite(amount) || amount <= 0 || String(refund.id) !== String(refundId)) {
    throw fail('Invalid verified refund');
  }
  const payment = await flutterwaveRequest(`/transactions/${encodeURIComponent(paymentId)}/verify`);
  if (String(payment?.id) !== paymentId || (refund.currency && String(refund.currency).toUpperCase() !== 'NGN')) {
    throw fail('Refund does not match the original NGN payment');
  }
  let tx = await Transaction.findOne({ provider: 'flutterwave', flutterwaveReference: String(payment?.tx_ref || '') });
  if (!tx) return;
  if (tx.type === 'tip_checkout') return applyFlutterwaveTipRefund({ tx, payment, refund, refundId });
  // Handle a refund notification arriving before the payment notification.
  tx = await fulfillFlutterwaveCredits(tx, payment);
  if (tx?.status !== 'completed') throw fail('Original payment is not confirmed', 503);
  const dbSession = await mongoose.startSession();
  try {
    await dbSession.withTransaction(async () => {
      if (await Transaction.findOne({ flutterwaveRefundId: String(refundId) }).session(dbSession)) return;
      const current = await Transaction.findById(tx._id).session(dbSession);
      const refunded = round2(Number(current.metadata.refundedNgn || 0) + amount);
      if (Math.round(refunded * 100) > Math.round(current.amount * 100)) throw fail('Refund exceeds original payment');
      const reversedTotal = Math.round(current.metadata.totalCredits * refunded / current.amount);
      const reversedCredits = reversedTotal - Number(current.metadata.refundedCredits || 0);
      const refundedUsd = round2(refunded / current.metadata.ngnPerUsd);
      await Transaction.create([{
        txCode: `FLW-REFUND-${refundId}`, type: 'credit_pack_refund', status: 'completed',
        provider: 'flutterwave', user: current.user, sourceTransaction: current._id,
        amount, currency: 'ngn', amountUsd: round2(refundedUsd - Number(current.metadata.refundedUsd || 0)),
        flutterwaveRefundId: String(refundId),
        description: `Credit purchase refund: ${reversedCredits} credits removed`,
        metadata: { packId: current.metadata.packId, totalCredits: reversedCredits,
          ngnPerUsd: current.metadata.ngnPerUsd, isTest: current.metadata.isTest }
      }], { session: dbSession });
      await Wallet.updateOne({ user: current.user }, { $inc: { balance: -reversedCredits } }, { session: dbSession });
      // A spent-and-refunded purchase can leave debt; clamping to zero would
      // create free credits and break the credit ledger.
      await Transaction.updateOne({ _id: current._id }, { $set: {
        'metadata.refundedNgn': refunded, 'metadata.refundedCredits': reversedTotal,
        'metadata.refundedUsd': refundedUsd
      } }, { session: dbSession });
    });
  } finally { await dbSession.endSession(); }
};

export const createFlutterwaveCreditCheckout = async ({ user, packId, expectedAmountNgn, requestId }) => {
  if (!flutterwaveEnabled()) throw fail('Flutterwave credit purchases are not enabled', 503);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(String(requestId || ''))) throw fail('A purchase request ID is required');
  const requestKey = `${user._id}:${requestId}`;
  const existing = await Transaction.findOne({ flutterwaveRequestKey: requestKey }).select('+flutterwaveCheckoutUrl');
  if (existing) {
    if (existing.metadata?.packId !== packId) throw fail('This purchase request belongs to another pack', 409);
    if (!existing.flutterwaveCheckoutUrl && existing.status === 'pending') throw fail('Checkout is being prepared. Please check again.', 409);
    return existing;
  }
  const pack = (await listCreditPacks()).find((p) => p.id === packId);
  const amount = round2(Number(pack?.flutterwavePriceNgn || 0));
  if (!pack || !Number.isFinite(amount) || amount <= 0) throw fail('This credit pack is not available with Flutterwave');
  if (Math.round(Number(expectedAmountNgn) * 100) !== Math.round(amount * 100)) {
    throw fail('The Naira price changed. Refresh the packs before paying.', 409);
  }
  const totalCredits = pack.credits + pack.bonusCredits;
  if (!Number.isSafeInteger(totalCredits) || totalCredits <= 0) throw fail('This pack has an invalid credit amount');
  // A real NGN/USD rate is required. Never treat Naira as dollars or use the
  // IAP reference price to report revenue from an independently priced sale.
  const ngn = await Currency.findOne({ country: 'NG', currency: 'NGN', isActive: true }).lean();
  const rate = Number(ngn?.usdRate);
  if (!Number.isFinite(rate) || rate <= 0) throw fail('Admin must configure the NGN/USD rate in Currencies', 503);
  let serverUrl;
  try { serverUrl = new URL(process.env.SERVER_URL || ''); }
  catch { throw fail('Configure SERVER_URL before using Flutterwave', 503); }
  if (serverUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(serverUrl.hostname)) {
    throw fail('Flutterwave requires a public HTTPS server URL', 503);
  }
  // Refuse checkout before taking money if atomic fulfillment cannot run.
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid' && !hello.serviceId) {
    throw fail('Flutterwave credits require a MongoDB replica set or Atlas', 503);
  }
  await Transaction.init();
  const reference = `PP-CREDITS-${crypto.randomUUID()}`;
  const tx = await Transaction.create({
    txCode: reference, type: 'credit_pack_purchase', status: 'pending', provider: 'flutterwave',
    user: user._id, amount, currency: 'ngn', country: user.country || undefined, amountUsd: round2(amount / rate),
    flutterwaveReference: reference, flutterwaveRequestKey: requestKey,
    description: `${pack.label} via Flutterwave`,
    metadata: { packId: pack.id, credits: pack.credits, bonusCredits: pack.bonusCredits,
      totalCredits, priceNgn: amount, pricingCountry: 'NG', ngnPerUsd: rate, referencePriceUsd: pack.priceUsd,
      isTest: isTestMode() }
  });
  await enqueueJob('flutterwave_credit_reconcile', { txId: String(tx._id) }, { delayMs: 60000, maxAttempts: 300 });
  try {
    const checkout = await flutterwaveRequest('/payments', { body: {
      tx_ref: reference, amount, currency: 'NGN',
      redirect_url: new URL('/api/v1/wallet/flutterwave/return', serverUrl).toString(),
      customer: { email: user.email, name: user.name },
      customizations: { title: 'Prophetic Pathway Credits', description: `${totalCredits} credits` },
      meta: { transactionId: String(tx._id) }
    } });
    if (!isAllowedFlutterwaveCheckoutUrl(checkout?.link)) {
      throw fail('Flutterwave returned an invalid checkout URL', 502);
    }
    tx.flutterwaveCheckoutUrl = new URL(checkout.link).toString();
    await tx.save();
    return tx;
  } catch (error) {
    // Preserve the receipt: if the provider accepted a timed-out request, its
    // webhook can still fulfill the original reference without a second sale.
    throw error;
  }
};

export const registerFlutterwaveJobHandlers = () => {
  registerFlutterwaveTipJobs();
  registerJobHandler('flutterwave_credit_reconcile', async ({ txId }) => {
    const tx = await Transaction.findOne({ _id: txId, provider: 'flutterwave', type: 'credit_pack_purchase' });
    if (!tx || tx.status === 'refunded') return;
    const result = await syncFlutterwavePurchase(tx);
    if (result.status === 'pending') throw new Error('Waiting for Flutterwave payment confirmation');
  });
};
