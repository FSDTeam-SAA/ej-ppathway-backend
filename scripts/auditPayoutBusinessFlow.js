// Read-only deployment audit. Does not create indexes, mutate balances or send payments.
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { REVENUE_TYPES, moneyUsdExpr } from '../utils/transactionReporting.js';
import { ADVISOR_TIP_TYPES, advisorTipBreakdownGroup } from '../utils/advisorTip.js';

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect();
  const db = client.db();
  const transactions = db.collection('transactions');
  const [work, tips, payouts, missingUsd, legacyPayouts, indexes] = await Promise.all([
    db.collection('sessions').aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, sessions: { $sum: 1 }, actualSeconds: { $sum: '$actualDurationSec' },
        missingDuration: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$actualDurationSec', null] }, null] }, 1, 0] } },
        bookedMinutes: { $sum: '$durationMinutes' } } }
    ]).toArray(),
    transactions.aggregate([{ $match: { type: { $in: ADVISOR_TIP_TYPES }, status: 'completed' } }, { $group: { _id: null, ...advisorTipBreakdownGroup } }]).toArray(),
    transactions.aggregate([{ $match: { type: 'advisor_payout' } }, { $group: { _id: '$withdrawalStatus', count: { $sum: 1 }, usd: { $sum: moneyUsdExpr } } }]).toArray(),
    transactions.countDocuments({ type: { $in: REVENUE_TYPES }, status: 'completed', amountUsd: null, currency: { $nin: ['usd', 'USD', null] } }),
    transactions.countDocuments({ type: 'advisor_payout', payoutServiceUsd: { $exists: false }, withdrawalStatus: { $in: ['requested', 'approved', 'processing', 'paid', 'failed'] } }),
    transactions.listIndexes().toArray()
  ]);
  console.log(JSON.stringify({ work: work[0] || {}, tips: tips[0] || {}, payouts, cashRecordsMissingUsd: missingUsd,
    legacyPayoutsRequiringReview: legacyPayouts,
    payoutRequestUniqueIndexPresent: indexes.some((i) => i.unique && i.key?.payoutRequestId === 1) }, null, 2));
} catch (error) {
  console.error(`Audit could not complete (${error.name}). Check database connectivity and credentials locally.`);
  process.exitCode = 1;
} finally { await client.close(); }
