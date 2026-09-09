import mongoose from 'mongoose';
import Session from '../models/session.model.js';
import Transaction from '../models/transaction.model.js';
import Wallet from '../models/wallet.model.js';

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
export const validateAdminPayout = ({ serviceAmountUsd = 0, tipAmountUsd = 0, sessionIds = [], requestId }) => {
  const money = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1000000 || Math.abs(n * 100 - Math.round(n * 100)) > 0.00001) fail('Amounts must be non-negative USD with at most two decimal places');
    return Math.round(n * 100) / 100;
  };
  const serviceUsd = money(serviceAmountUsd), tipUsd = money(tipAmountUsd);
  if (!Array.isArray(sessionIds) || sessionIds.length > 500 || sessionIds.some((id) => !/^[a-f0-9]{24}$/i.test(String(id)))) fail('Select valid session IDs (maximum 500)');
  const ids = [...new Set(sessionIds.map(String))];
  if (ids.length !== sessionIds.length) fail('Duplicate session IDs');
  if ((serviceUsd > 0) !== (ids.length > 0)) fail('Select sessions and enter their service payment amount together');
  if (serviceUsd + tipUsd <= 0) fail('Enter a session payment or tip payment');
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) fail('A valid payment request ID is required');
  return { serviceUsd, tipUsd, ids, amountUsd: Math.round((serviceUsd + tipUsd) * 100) / 100 };
};

export async function createAdminPricedPayout({ advisor, initiatedBy, note, ...input }) {
  const a = validateAdminPayout(input);
  const existing = await Transaction.findOne({ payoutRequestId: input.requestId });
  const checkExisting = (tx) => {
    if (String(tx.advisor) !== String(advisor._id) || tx.payoutServiceUsd !== a.serviceUsd || tx.payoutTipUsd !== a.tipUsd ||
        [...tx.payoutSessionIds].map(String).sort().join(',') !== [...a.ids].sort().join(',')) fail('Payment request ID already used for different details', 409);
    return tx;
  };
  if (existing) return checkExisting(existing);
  const dbSession = await mongoose.startSession();
  let tx;
  try {
    await dbSession.withTransaction(async () => {
      // Old unlinked service payouts cannot be assigned to sessions automatically.
      // Require reconciliation before making a second service payment to that advisor.
      if (a.ids.length && await Transaction.exists({ advisor: advisor._id, type: 'advisor_payout', payoutServiceUsd: { $exists: false },
        withdrawalStatus: { $in: ['paid', 'requested', 'approved', 'processing', 'failed'] },
        $or: [{ payoutCredits: { $gt: 0 } }, { payoutCredits: { $exists: false } }] }).session(dbSession)) {
        fail('This advisor has legacy service payouts. Reconcile their sessions before creating a new service payment.', 409);
      }
      const sessions = await Session.find({ _id: { $in: a.ids }, advisor: advisor._id, status: 'completed', servicePayout: null, actualDurationSec: { $gt: 0 } }).session(dbSession);
      if (sessions.length !== a.ids.length) fail('Some sessions are already assigned, incomplete, or belong to another advisor. Refresh and select again.', 409);
      if (a.tipUsd > 0) {
        const held = await Wallet.findOneAndUpdate({ user: advisor._id, tipEarningsBalanceUsd: { $gte: a.tipUsd } },
          { $inc: { tipEarningsBalanceUsd: -a.tipUsd, pendingTipPayoutUsd: a.tipUsd } }, { session: dbSession });
        if (!held) fail('Insufficient net tip balance', 409);
      }
      [tx] = await Transaction.create([{
        type: 'advisor_payout', status: 'pending', provider: 'hyperwallet', advisor: advisor._id,
        amount: a.amountUsd, amountUsd: a.amountUsd, currency: 'usd',
        payoutCredits: 0, payoutTipUsd: a.tipUsd, payoutServiceUsd: a.serviceUsd,
        payoutSessionIds: a.ids, payoutSessionSeconds: sessions.reduce((sum, s) => sum + s.actualDurationSec, 0),
        payoutRequestId: input.requestId, description: note || 'Admin-approved session and tip payment',
        withdrawalStatus: 'requested', withdrawalRequestedAt: new Date(), withdrawalMethod: 'hyperwallet',
        hyperwalletUserToken: advisor.hyperwallet?.userToken,
        metadata: { payoutSourceVersion: 3, initiatedBy: String(initiatedBy), serviceAmountUsd: a.serviceUsd, tipAmountUsd: a.tipUsd }
      }], { session: dbSession });
      if (a.ids.length) {
        const claimed = await Session.updateMany({ _id: { $in: a.ids }, servicePayout: null }, { $set: { servicePayout: tx._id } }, { session: dbSession });
        if (claimed.modifiedCount !== a.ids.length) fail('Session payment changed; please refresh', 409);
      }
    });
  } catch (e) {
    if (e.code === 11000) {
      const duplicate = await Transaction.findOne({ payoutRequestId: input.requestId });
      if (duplicate) return checkExisting(duplicate);
    }
    throw e;
  } finally { await dbSession.endSession(); }
  return tx;
}
