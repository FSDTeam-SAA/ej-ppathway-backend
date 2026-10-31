import Session from '../models/session.model.js';
import Wallet from '../models/wallet.model.js';
import Transaction from '../models/transaction.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import { computeTier } from './tier.service.js';

const round2 = (n) => Math.round(n * 100) / 100;
const roundCredits = (n) => Math.ceil(Number(n || 0));

/**
 * Charge user wallet (free credits first, then purchased credits) for `amount`.
 * Returns details on success, throws on insufficient.
 */
export const chargeUserWallet = async ({ userId, amount }) => {
  const charge = roundCredits(amount);
  if (!Number.isFinite(charge) || charge < 0) throw new Error('Invalid wallet charge');
  // Compare-and-retry prevents a session charge from overwriting credits that
  // arrive concurrently from a verified checkout/webhook.
  for (let attempt = 0; attempt < 10; attempt++) {
    const wallet = await Wallet.findOne({ user: userId });
    if (!wallet) throw new Error('Wallet not found');
    const creditsUsed = Math.min(Math.max(0, wallet.freeCredits), charge);
    const balanceUsed = charge - creditsUsed;
    if (balanceUsed > 0 && wallet.balance < balanceUsed) {
      throw Object.assign(new Error('Insufficient balance'), { code: 'INSUFFICIENT_FUNDS' });
    }
    const updated = await Wallet.findOneAndUpdate(
      { _id: wallet._id, balance: wallet.balance, freeCredits: wallet.freeCredits },
      { $inc: { balance: -balanceUsed, freeCredits: -creditsUsed, totalSpent: charge } },
      { returnDocument: 'after' }
    );
    if (updated) return { creditsUsed, balanceUsed };
  }
  throw Object.assign(new Error('Wallet is busy. Please try again.'), { statusCode: 409 });
};

/**
 * Refund to user wallet (refund goes back to purchased credits, not free credits).
 */
export const refundToUserWallet = async ({ userId, amount }) => {
  const refund = Number(amount);
  if (!Number.isFinite(refund) || refund < 0) throw new Error('Invalid wallet refund');
  const wallet = await Wallet.findOneAndUpdate({ user: userId }, [
    { $set: {
      balance: { $round: [{ $add: [{ $ifNull: ['$balance', 0] }, refund] }, 2] },
      totalSpent: { $round: [{ $max: [0, { $subtract: [{ $ifNull: ['$totalSpent', 0] }, refund] }] }, 2] },
      updatedAt: '$$NOW'
    } }
  ], { returnDocument: 'after' });
  if (!wallet) throw new Error('Wallet not found');
  return wallet;
};

/**
 * Credit advisor wallet (earnings).
 */
export const creditAdvisor = async ({ advisorId, amount }) => {
  const wallet = await Wallet.findOneAndUpdate(
    { user: advisorId },
    { $inc: { earningsBalance: round2(amount), totalEarned: round2(amount) } },
    { returnDocument: 'after', upsert: true }
  );
  return wallet;
};

/**
 * Settle user credits and record actual work. Admin prices advisor payments separately.
 */
export const settleSession = async (session) => {
  if (!session.startedAt || !session.endedAt) return session;
  const sec = Math.max(0, Math.round((session.endedAt - session.startedAt) / 1000));
  session.actualDurationSec = sec;

  const minutes = sec / 60;
  const grossUserCharge = roundCredits(minutes * session.ratePerMin);

  // user has been charging incrementally during session normally; final settle = final charge for any remainder
  // Here we assume holdAmount was charged upfront; we reconcile.
  const targetUserCharge = grossUserCharge;
  const alreadyCharged = session.chargedAmount || 0;

  const diff = round2(targetUserCharge - alreadyCharged);
  if (diff > 0) {
    try {
      const { creditsUsed, balanceUsed } = await chargeUserWallet({ userId: session.user, amount: diff });
      session.creditsUsed = round2((session.creditsUsed || 0) + creditsUsed);
      session.chargedAmount = round2(alreadyCharged + creditsUsed + balanceUsed);
      await Transaction.create({
        type: 'session_charge',
        status: 'completed',
        user: session.user,
        advisor: session.advisor,
        session: session._id,
        amount: round2(creditsUsed + balanceUsed),
        description: `Final session charge for ${session.sessionCode}`,
        metadata: { creditsUsed, balanceUsed }
      });
    } catch (e) {
      // if fail, cap to what was already charged
      session.chargedAmount = alreadyCharged;
    }
  } else if (diff < 0) {
    // user was over-charged in holds, refund the difference
    const refund = Math.abs(diff);
    await refundToUserWallet({ userId: session.user, amount: refund });
    session.chargedAmount = round2(alreadyCharged - refund);
    session.refundIssued = round2((session.refundIssued || 0) + refund);
    await Transaction.create({
      type: 'session_refund',
      status: 'completed',
      user: session.user,
      session: session._id,
      amount: refund,
      description: `Session refund (overcharge) for ${session.sessionCode}`
    });
  }

  // Session work is paid only when an admin assigns a USD payout.
  session.advisorPayout = 0;

  // update advisor stats
  await AdvisorProfile.findOneAndUpdate(
    { user: session.advisor },
    {
      $inc: {
        totalSessions: 1,
        completedSessions: 1,
        totalProphecy: 1
      }
    }
  );

  // recompute tier in background-ish (await is fine; cheap)
  await computeTier(session.advisor);

  session.status = 'completed';
  return session;
};

export default { chargeUserWallet, refundToUserWallet, creditAdvisor, settleSession };
