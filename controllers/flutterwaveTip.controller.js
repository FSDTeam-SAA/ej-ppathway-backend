import mongoose from 'mongoose';
import Transaction from '../models/transaction.model.js';
import { createFlutterwaveTipCheckout, flutterwaveTipCatalog, syncFlutterwaveTip } from '../services/flutterwaveTip.service.js';
import { cancelFlutterwaveCheckout } from '../services/flutterwave.service.js';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';

const data = tx => ({
  txId: String(tx._id), sessionId: String(tx.session), amount: tx.amount, currency: 'NGN',
  status: Number(tx.metadata?.refundedNgn || 0) >= tx.amount ? 'refunded'
    : tx.metadata?.refundRequired ? 'refund_pending' : tx.status,
  checkoutUrl: tx.flutterwaveCheckoutUrl, reference: tx.flutterwaveReference, isTest: tx.metadata?.isTest === true
});
export const tipCatalog = catchAsync(async (req, res) => sendResponse(res, { data: await flutterwaveTipCatalog(req.user) }));
export const tipCheckout = catchAsync(async (req, res) => {
  if (!mongoose.isValidObjectId(req.body.sessionId)) throw new ApiError(400, 'Invalid session ID');
  const tx = await createFlutterwaveTipCheckout({ user: req.user, sessionId: req.body.sessionId,
    packId: String(req.body.packId || ''), expectedAmountNgn: req.body.expectedAmountNgn, requestId: req.body.requestId });
  return sendResponse(res, { data: data(tx) });
});
export const tipPending = catchAsync(async (req, res) => {
  if (!mongoose.isValidObjectId(req.query.sessionId)) throw new ApiError(400, 'Invalid session ID');
  const txs = await Transaction.find({ user: req.user._id, session: req.query.sessionId,
    provider: 'flutterwave', type: 'tip_checkout', status: 'pending' }).select('+flutterwaveCheckoutUrl').sort({ createdAt: -1 });
  return sendResponse(res, { data: txs.map(data) });
});
const ownedTip = async (id, userId, withUrl = false) => {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, 'Invalid tip payment ID');
  const query = Transaction.findOne({ _id: id, user: userId, provider: 'flutterwave', type: 'tip_checkout' });
  const tx = await (withUrl ? query.select('+flutterwaveCheckoutUrl') : query);
  if (!tx) throw new ApiError(404, 'Tip payment not found');
  return tx;
};
export const tipStatus = catchAsync(async (req, res) => {
  const tx = await ownedTip(req.query.txId, req.user._id, true);
  const transactionId = req.query.transactionId ? String(req.query.transactionId) : undefined;
  if (transactionId && !/^\d+$/.test(transactionId)) throw new ApiError(400, 'Invalid Flutterwave transaction ID');
  return sendResponse(res, { data: data(await syncFlutterwaveTip(tx, transactionId)) });
});
export const tipCancel = catchAsync(async (req, res) => {
  const tx = await ownedTip(req.body.txId, req.user._id, true);
  return sendResponse(res, { data: data(await cancelFlutterwaveCheckout(tx)) });
});
