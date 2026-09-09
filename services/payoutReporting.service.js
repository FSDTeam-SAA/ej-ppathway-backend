import Session from '../models/session.model.js';
import Transaction from '../models/transaction.model.js';

export async function servicePaymentSummaries(advisorIds) {
  const [sessions, payouts] = await Promise.all([
    Session.aggregate([
      { $match: { ...(advisorIds ? { advisor: { $in: advisorIds } } : {}), status: 'completed', servicePayout: null } },
      { $group: { _id: '$advisor', unpaidSeconds: { $sum: '$actualDurationSec' }, unpaidSessions: { $sum: 1 } } }
    ]),
    Transaction.aggregate([
      { $match: { ...(advisorIds ? { advisor: { $in: advisorIds } } : {}), type: 'advisor_payout', payoutServiceUsd: { $exists: true } } },
      { $group: { _id: '$advisor',
        pendingServiceUsd: { $sum: { $cond: [{ $in: ['$withdrawalStatus', ['requested', 'approved', 'processing']] }, '$payoutServiceUsd', 0] } },
        paidServiceUsd: { $sum: { $cond: [{ $eq: ['$withdrawalStatus', 'paid'] }, '$payoutServiceUsd', 0] } }
      } }
    ])
  ]);
  const map = new Map();
  for (const item of [...sessions, ...payouts]) map.set(String(item._id), { ...(map.get(String(item._id)) || {}), ...item });
  return map;
}

export function serviceSummary(map, id) {
  const row = map.get(String(id)) || {};
  return { unpaidSeconds: row.unpaidSeconds || 0, unpaidSessions: row.unpaidSessions || 0,
    pendingServiceUsd: row.pendingServiceUsd || 0, paidServiceUsd: row.paidServiceUsd || 0 };
}
