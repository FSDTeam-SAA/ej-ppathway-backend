import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Transaction from '../models/transaction.model.js';
import Wallet from '../models/wallet.model.js';
import { creditsToUsd, getPayoutConfig } from '../services/payout.service.js';

const MIGRATION_VERSION = 2;
const applyChanges = process.argv.includes('--apply');

const unmigratedLegacyTipFilter = {
  type: 'advisor_tip',
  status: 'completed',
  'metadata.tipBalanceSplitVersion': { $ne: MIGRATION_VERSION }
};

const roundCredits = (value) => Math.round((Number(value) || 0) * 100) / 100;

const migrateAdvisorTips = async ({ advisorId, credits, count, payoutRateUsd }) => {
  const tipUsd = creditsToUsd(credits, { payoutCreditUsdRate: payoutRateUsd });
  const dbSession = await mongoose.startSession();

  try {
    await dbSession.withTransaction(async () => {
      const wallet = await Wallet.findOne({ user: advisorId }).session(dbSession);
      if (!wallet) throw new Error(`Wallet not found for advisor ${advisorId}`);
      if (Number(wallet.earningsBalance || 0) + 0.001 < credits) {
        throw new Error(
          `Advisor ${advisorId} has ${wallet.earningsBalance || 0} service credits, below the ${credits} legacy tip credits to split`
        );
      }

      const updatedWallet = await Wallet.findOneAndUpdate(
        { user: advisorId, earningsBalance: { $gte: credits } },
        {
          $inc: {
            earningsBalance: -credits,
            totalEarned: -credits,
            tipEarningsBalanceUsd: tipUsd,
            totalTipEarnedUsd: tipUsd
          }
        },
        { returnDocument: 'after', session: dbSession }
      );
      if (!updatedWallet) throw new Error(`Legacy tip balance changed for advisor ${advisorId}; retry migration`);

      const marked = await Transaction.updateMany(
        { ...unmigratedLegacyTipFilter, advisor: advisorId },
        {
          $set: {
            'metadata.tipBalanceSplitVersion': MIGRATION_VERSION,
            'metadata.tipBalanceSplitRateUsd': payoutRateUsd,
            'metadata.tipBalanceSplitMigratedAt': new Date()
          }
        },
        { session: dbSession }
      );
      if (marked.modifiedCount !== count) {
        throw new Error(
          `Expected to mark ${count} legacy tips for advisor ${advisorId}, marked ${marked.modifiedCount}; retry migration`
        );
      }
    });
  } finally {
    await dbSession.endSession();
  }

  return tipUsd;
};

const run = async () => {
  await connectDB();
  const config = await getPayoutConfig();
  const payoutRateUsd = Number(config.payoutCreditUsdRate || 0);
  if (payoutRateUsd <= 0) throw new Error('A positive payout credit USD rate is required');

  const groups = await Transaction.aggregate([
    { $match: unmigratedLegacyTipFilter },
    {
      $group: {
        _id: '$advisor',
        credits: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  const plan = groups.map((group) => {
    const credits = roundCredits(group.credits);
    return {
      advisorId: String(group._id),
      transactions: group.count,
      serviceCreditsToMove: credits,
      tipUsdToAdd: creditsToUsd(credits, config)
    };
  });

  console.log(JSON.stringify({ mode: applyChanges ? 'apply' : 'dry-run', payoutRateUsd, plan }, null, 2));
  if (!applyChanges || !groups.length) return;

  for (const group of groups) {
    const credits = roundCredits(group.credits);
    await migrateAdvisorTips({
      advisorId: group._id,
      credits,
      count: group.count,
      payoutRateUsd
    });
  }

  console.log(`Migrated ${groups.reduce((total, group) => total + group.count, 0)} legacy tip transactions.`);
};

run()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
