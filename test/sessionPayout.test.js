import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import Transaction from '../models/transaction.model.js';
import Session from '../models/session.model.js';
import Wallet from '../models/wallet.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import { settleSession } from '../services/session.service.js';
import { createAdminPricedPayout, validateAdminPayout } from '../services/sessionPayout.service.js';
import { finalizePaid, finalizeFailed, rejectPayout, markPaidManually } from '../services/payout.service.js';

const advisor = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' };
const sessionId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const input = { serviceAmountUsd: 25, tipAmountUsd: 8, sessionIds: [sessionId], requestId: 'test-payment-request-001' };
const query = (value) => ({ session: async () => value });

test('settling twenty user credits records ten minutes without creating advisor money', async (t) => {
  const tx = t.mock.method(Transaction, 'create', async () => {});
  const wallet = t.mock.method(Wallet, 'findOneAndUpdate', async () => {});
  t.mock.method(AdvisorProfile, 'findOneAndUpdate', async (_, update) => {
    assert.equal(update.$inc.grossEarnings, undefined);
    assert.equal(update.$inc.netEarnings, undefined);
  });
  t.mock.method(AdvisorProfile, 'findOne', async () => null);
  const session = { user: 'user', advisor: advisor._id, startedAt: new Date(0), endedAt: new Date(600000), ratePerMin: 2, chargedAmount: 20 };
  await settleSession(session);
  assert.equal(session.actualDurationSec, 600);
  assert.equal(session.chargedAmount, 20);
  assert.equal(session.advisorPayout, 0);
  assert.equal(session.status, 'completed');
  assert.equal(tx.mock.callCount(), 0);
  assert.equal(wallet.mock.callCount(), 0);
});

test('repeated completion cannot debit the held tip balance twice', async (t) => {
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async (fn) => fn(), endSession: async () => {} }));
  const paid = { _id: 'payout', withdrawalStatus: 'paid' };
  t.mock.method(Transaction, 'findOneAndUpdate', async (filter) => {
    assert.deepEqual(filter.withdrawalStatus.$in, ['requested', 'approved', 'processing']);
    return null;
  });
  t.mock.method(Transaction, 'findById', () => query(paid));
  const wallet = t.mock.method(Wallet, 'updateOne', async () => {});
  assert.equal(await finalizePaid(paid), paid);
  assert.equal(wallet.mock.callCount(), 0);
});

test('manual completion cannot race a provider payment already processing', async (t) => {
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async (fn) => fn(), endSession: async () => {} }));
  t.mock.method(Transaction, 'findOneAndUpdate', async (filter) => {
    assert.deepEqual(filter.withdrawalStatus.$in, ['requested', 'approved']);
    return null;
  });
  t.mock.method(Transaction, 'findById', () => query({ withdrawalStatus: 'processing' }));
  await assert.rejects(markPaidManually({ _id: 'payout' }, 'admin'), /Only unsent/);
});

test('admin payment requires explicit work and cent-precision amounts', () => {
  assert.deepEqual(validateAdminPayout(input), { serviceUsd: 25, tipUsd: 8, ids: [sessionId], amountUsd: 33 });
  for (const bad of [
    { serviceAmountUsd: -1 }, { serviceAmountUsd: 0 }, { serviceAmountUsd: 1.001 },
    { sessionIds: [] }, { sessionIds: [sessionId, sessionId] }, { requestId: '' }, { tipAmountUsd: NaN }
  ]) assert.throws(() => validateAdminPayout({ ...input, ...bad }));
  assert.equal(validateAdminPayout({ ...input, serviceAmountUsd: 0, sessionIds: [] }).amountUsd, 8);
});

test('session payment uses admin amount, holds only tips and claims selected work', async (t) => {
  const dbSession = { withTransaction: async (fn) => fn(), endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => dbSession);
  t.mock.method(Transaction, 'findOne', async () => null);
  t.mock.method(Transaction, 'exists', () => query(null));
  t.mock.method(Session, 'find', (filter) => {
    assert.equal(filter.advisor, advisor._id);
    assert.equal(filter.servicePayout, null);
    return query([{ actualDurationSec: 600, chargedAmount: 20 }]);
  });
  t.mock.method(Wallet, 'findOneAndUpdate', async (filter, update) => {
    assert.deepEqual(filter, { user: advisor._id, tipEarningsBalanceUsd: { $gte: 8 } });
    assert.deepEqual(update.$inc, { tipEarningsBalanceUsd: -8, pendingTipPayoutUsd: 8 });
    return {};
  });
  t.mock.method(Transaction, 'create', async ([row]) => [{ ...row, _id: 'payout' }]);
  t.mock.method(Session, 'updateMany', async (filter, update) => {
    assert.equal(filter.servicePayout, null);
    assert.equal(update.$set.servicePayout, 'payout');
    return { modifiedCount: 1 };
  });
  const tx = await createAdminPricedPayout({ ...input, advisor, initiatedBy: 'admin' });
  assert.equal(tx.amountUsd, 33);
  assert.equal(tx.payoutServiceUsd, 25);
  assert.equal(tx.payoutCredits, 0);
  assert.equal(tx.payoutSessionSeconds, 600);
});

test('retrying the same request returns its payout and rejects a changed amount', async (t) => {
  const tx = { advisor: advisor._id, payoutServiceUsd: 25, payoutTipUsd: 8, payoutSessionIds: [sessionId] };
  t.mock.method(Transaction, 'findOne', async () => tx);
  assert.equal(await createAdminPricedPayout({ ...input, advisor }), tx);
  await assert.rejects(createAdminPricedPayout({ ...input, advisor, serviceAmountUsd: 26 }), /different details/);
});

test('already assigned work and insufficient tip funds cannot be queued', async (t) => {
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async (fn) => fn(), endSession: async () => {} }));
  t.mock.method(Transaction, 'findOne', async () => null);
  t.mock.method(Transaction, 'exists', () => query(null));
  const find = t.mock.method(Session, 'find', () => query([]));
  await assert.rejects(createAdminPricedPayout({ ...input, advisor }), /already assigned/);
  find.mock.mockImplementation(() => query([{ actualDurationSec: 600 }]));
  t.mock.method(Wallet, 'findOneAndUpdate', async () => null);
  await assert.rejects(createAdminPricedPayout({ ...input, advisor }), /Insufficient net tip/);
});

test('finalization changes only tip ledger; rejection releases session assignment', async (t) => {
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async (fn) => fn(), endSession: async () => {} }));
  const tx = { _id: 'payout', advisor: advisor._id, payoutCredits: 0, payoutServiceUsd: 25, payoutTipUsd: 8 };
  let inc;
  t.mock.method(Transaction, 'findOneAndUpdate', async () => tx);
  t.mock.method(Wallet, 'updateOne', async (_, update) => { inc = update.$inc; });
  const release = t.mock.method(Session, 'updateMany', async () => ({}));
  await finalizePaid(tx);
  assert.deepEqual(inc, { pendingTipPayoutUsd: -8, totalTipWithdrawnUsd: 8 });
  await finalizeFailed(tx, 'failure');
  assert.deepEqual(inc, { pendingTipPayoutUsd: -8, tipEarningsBalanceUsd: 8 });
  assert.equal(release.mock.callCount(), 0); // failed work stays assigned for retry
  await rejectPayout(tx, 'cancel payment', 'admin');
  assert.equal(release.mock.callCount(), 1);
  assert.deepEqual(release.mock.calls[0].arguments[0], { servicePayout: 'payout' });
});
