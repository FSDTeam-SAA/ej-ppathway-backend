import Session from '../models/session.model.js';
import Wallet from '../models/wallet.model.js';
import Transaction from '../models/transaction.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import { commissionPercentForAdvisor, computeTier } from './tier.service.js';

const round2 = (n) => Math.round(n * 100) / 100;
const roundCredits = (n) => Math.ceil(Number(n || 0));

/**
 * Charge user wallet (free credits first, then purchased credits) for `amount`.
 * Returns details on success, throws on insufficient.
 */
export const chargeUserWallet = async ({ userId, amount }) => {
  const wallet = await Wallet.findOne({ user: userId });
  if (!wallet) throw new Error('Wallet not found');
  let amt = roundCredits(amount);
  let creditsUsed = 0;
  let balanceUsed = 0;

  if (wallet.freeCredits > 0) {
    creditsUsed = Math.min(wallet.freeCredits, amt);
    wallet.freeCredits = round2(wallet.freeCredits - creditsUsed);
    amt = roundCredits(amt - creditsUsed);
  }
  if (amt > 0) {
    if (wallet.balance < amt) {
      throw Object.assign(new Error('Insufficient balance'), { code: 'INSUFFICIENT_FUNDS' });
    }
    wallet.balance = round2(wallet.balance - amt);
    balanceUsed = amt;
  }
  wallet.totalSpent = round2(wallet.totalSpent + creditsUsed + balanceUsed);
  await wallet.save();
  return { creditsUsed, balanceUsed };
};

/**
 * Refund to user wallet (refund goes back to purchased credits, not free credits).
 */
export const refundToUserWallet = async ({ userId, amount }) => {
  const wallet = await Wallet.findOne({ user: userId });
  if (!wallet) throw new Error('Wallet not found');
  wallet.balance = round2(wallet.balance + Number(amount));
  wallet.totalSpent = round2(Math.max(0, wallet.totalSpent - Number(amount)));
  await wallet.save();
  return wallet;
};

/**
 * Credit advisor wallet (earnings).
 */
export const creditAdvisor = async ({ advisorId, amount }) => {
  const wallet = await Wallet.findOneAndUpdate(
    { user: advisorId },
    { $inc: { earningsBalance: round2(amount), totalEarned: round2(amount) } },
    { new: true, upsert: true }
  );
  return wallet;
};

/**
 * Settle a session: compute used minutes, charge user, pay advisor minus commission.
 */
export const settleSession = async (session) => {
  if (!session.startedAt || !session.endedAt) return session;
  const sec = Math.max(0, Math.round((session.endedAt - session.startedAt) / 1000));
  session.actualDurationSec = sec;

  const minutes = sec / 60;
  const grossUserCharge = roundCredits(minutes * session.ratePerMin);

  // determine commission from advisor tier (snapshot here)
  const commissionPct = await commissionPercentForAdvisor(session.advisor);
  session.commissionPercent = commissionPct;

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

  // advisor payout = chargedAmount * (100 - commission)/100
  const finalCharge = session.chargedAmount;
  const platformCommission = round2((finalCharge * commissionPct) / 100);
  const advisorPayout = round2(finalCharge - platformCommission);
  session.platformCommission = platformCommission;
  session.advisorPayout = advisorPayout;

  if (advisorPayout > 0) {
    await creditAdvisor({ advisorId: session.advisor, amount: advisorPayout });
    await Transaction.create({
      type: 'advisor_earning',
      status: 'completed',
      user: session.user,
      advisor: session.advisor,
      session: session._id,
      amount: advisorPayout,
      description: `Earnings from session ${session.sessionCode}`
    });
    await Transaction.create({
      type: 'platform_commission',
      status: 'completed',
      user: session.user,
      advisor: session.advisor,
      session: session._id,
      amount: platformCommission,
      description: `Platform commission ${commissionPct}% on session ${session.sessionCode}`
    });
  }

  // update advisor stats
  await AdvisorProfile.findOneAndUpdate(
    { user: session.advisor },
    {
      $inc: {
        totalSessions: 1,
        completedSessions: 1,
        grossEarnings: finalCharge,
        netEarnings: advisorPayout,
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
