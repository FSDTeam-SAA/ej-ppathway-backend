import mongoose from 'mongoose';
import Transaction from '../models/transaction.model.js';
import Wallet from '../models/wallet.model.js';
import { listCreditPacks } from '../services/credit.service.js';
import { applyFlutterwaveCreditRefund, cancelFlutterwaveCheckout, createFlutterwaveCreditCheckout, flutterwaveEnabled, flutterwaveSecretMatches, syncFlutterwavePurchase } from '../services/flutterwave.service.js';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';

const checkoutData = (tx) => ({ txId: String(tx._id), status:
  Number(tx.metadata?.refundedNgn || 0) >= tx.amount ? 'refunded' : tx.status,
  checkoutUrl: tx.flutterwaveCheckoutUrl, amount: tx.amount, currency: 'NGN',
  isTest: tx.metadata?.isTest === true,
  totalCredits: tx.metadata.totalCredits, reference: tx.flutterwaveReference });

export const flutterwaveCatalog = catchAsync(async (_req, res) => {
  const enabled = flutterwaveEnabled();
  const packs = enabled ? (await listCreditPacks()).filter((p) => p.flutterwavePriceNgn > 0) : [];
  return sendResponse(res, { data: { enabled, currency: 'NGN', packs } });
});

export const flutterwaveCheckout = catchAsync(async (req, res) => {
  const tx = await createFlutterwaveCreditCheckout({ user: req.user,
    packId: String(req.body.packId || ''), expectedAmountNgn: req.body.expectedAmountNgn,
    requestId: req.body.requestId
  });
  return sendResponse(res, { data: checkoutData(tx) });
});

export const flutterwavePending = catchAsync(async (req, res) => {
  const purchases = await Transaction.find({ user: req.user._id, provider: 'flutterwave',
    type: 'credit_pack_purchase', status: 'pending' }).select('+flutterwaveCheckoutUrl').sort({ createdAt: -1 }).limit(20);
  return sendResponse(res, { data: purchases.map(checkoutData) });
});

export const flutterwaveStatus = catchAsync(async (req, res) => {
  if (!mongoose.isValidObjectId(req.query.txId)) throw new ApiError(400, 'Invalid purchase ID');
  let tx = await Transaction.findOne({ _id: req.query.txId, user: req.user._id,
    provider: 'flutterwave', type: 'credit_pack_purchase' });
  if (!tx) throw new ApiError(404, 'Purchase not found');
  const transactionId = req.query.transactionId ? String(req.query.transactionId) : undefined;
  if (transactionId && !/^\d+$/.test(transactionId)) throw new ApiError(400, 'Invalid Flutterwave transaction ID');
  tx = await syncFlutterwavePurchase(tx, transactionId);
  const wallet = await Wallet.findOne({ user: req.user._id });
  return sendResponse(res, { data: { ...checkoutData(tx), walletBalance: wallet?.balance || 0 } });
});

export const flutterwaveCancel = catchAsync(async (req, res) => {
  if (!mongoose.isValidObjectId(req.body.txId)) throw new ApiError(400, 'Invalid purchase ID');
  const tx = await Transaction.findOne({ _id: req.body.txId, user: req.user._id,
    provider: 'flutterwave', type: 'credit_pack_purchase' }).select('+flutterwaveCheckoutUrl');
  if (!tx) throw new ApiError(404, 'Purchase not found');
  return sendResponse(res, { data: checkoutData(await cancelFlutterwaveCheckout(tx)) });
});

export const flutterwaveReturn = catchAsync(async (req, res) => {
  const tx = await Transaction.findOne({ provider: 'flutterwave', flutterwaveReference: String(req.query.tx_ref || '') });
  if (!tx) throw new ApiError(404, 'Purchase not found');
  // Callback query status is untrusted. The server always queries the provider.
  const result = await syncFlutterwavePurchase(tx, req.query.transaction_id ? String(req.query.transaction_id) : undefined);
  const isTip = tx.type === 'tip_checkout';
  const message = result.status === 'completed'
    ? result.metadata?.refundRequired ? 'This session already received a tip. The extra payment is being refunded.'
      : isTip ? 'Payment confirmed. Your tip has been sent.' : 'Payment confirmed. Your credits have been added.'
    : 'Payment is not confirmed yet. Return to the app to check your purchase.';
  res.type('html').send(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment</title><body style="font-family:system-ui;max-width:34rem;margin:4rem auto;padding:1.5rem"><h1>Prophetic Pathway</h1><p>${message}</p><p>You can close this tab and return to ${isTip ? 'Leave a Tip' : 'Buy Credits'} in the app.</p></body></html>`);
});

export const flutterwaveWebhook = async (req, res) => {
  if (!flutterwaveSecretMatches(req.get('verif-hash'))) return res.status(401).json({ ok: false });
  try {
    if (req.body?.event === 'refund.completed' || req.body?.TransactionId) {
      const refundId = req.body?.data?.id ?? req.body?.id;
      if (!refundId) return res.status(400).json({ ok: false });
      await applyFlutterwaveCreditRefund(String(refundId));
      return res.status(200).json({ ok: true });
    }
    if (req.body?.event !== 'charge.completed') return res.status(200).json({ ok: true, skipped: true });
    const tx = await Transaction.findOne({ provider: 'flutterwave',
      flutterwaveReference: String(req.body?.data?.tx_ref || '') });
    if (!tx) return res.status(200).json({ ok: true, skipped: true });
    if (!req.body?.data?.id) return res.status(400).json({ ok: false });
    await syncFlutterwavePurchase(tx, String(req.body.data.id));
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Flutterwave webhook failed', error.message);
    // Non-2xx asks Flutterwave to retry after network/database failures.
    return res.status(error.statusCode === 400 ? 400 : 503).json({ ok: false });
  }
};
