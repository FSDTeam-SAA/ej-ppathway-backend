import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Wallet from '../models/wallet.model.js';
import Session from '../models/session.model.js';
import Transaction from '../models/transaction.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import Review from '../models/review.model.js';
import { refundToUserWallet } from '../services/session.service.js';
import { myAdvisorSessions } from '../controllers/session.controller.js';

test('refund passes the real Mongoose pipeline validation and returns the updated wallet', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const wallet = { user: userId, balance: 15, totalSpent: 5 };
  // Mock only the database boundary so Mongoose still validates the update.
  const update = t.mock.method(Wallet.collection, 'findOneAndUpdate', async (filter, pipeline) => {
    assert.equal(String(filter.user), String(userId));
    assert.deepEqual(pipeline[0].$set.balance, {
      $round: [{ $add: [{ $ifNull: ['$balance', 0] }, 5] }, 2]
    });
    assert.deepEqual(pipeline[0].$set.totalSpent, {
      $round: [{ $max: [0, { $subtract: [{ $ifNull: ['$totalSpent', 0] }, 5] }] }, 2]
    });
    return wallet;
  });
  const result = await refundToUserWallet({ userId, amount: 5 });
  assert.equal(result.balance, 15);
  assert.equal(result.totalSpent, 5);
  assert.equal(update.mock.callCount(), 1);
});

test('session list completes when an overdue live session needs an overcharge refund', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  let saved = false;
  const session = {
    _id: new mongoose.Types.ObjectId(), user: userId,
    advisor: new mongoose.Types.ObjectId(), status: 'live',
    startedAt: new Date(Date.now() - 20 * 60 * 1000),
    durationMinutes: 10, ratePerMin: 1, chargedAmount: 20,
    save: async () => { saved = true; },
    toObject() { return { ...this }; }
  };
  const chain = {};
  for (const method of ['populate', 'sort', 'skip']) chain[method] = () => chain;
  chain.limit = async () => [session];
  t.mock.method(Session, 'find', () => chain);
  t.mock.method(Session, 'countDocuments', async () => 1);
  const refund = t.mock.method(Wallet.collection, 'findOneAndUpdate', async () => ({ user: userId, balance: 10 }));
  const transactions = t.mock.method(Transaction, 'create', async () => {});
  t.mock.method(AdvisorProfile, 'findOneAndUpdate', async () => null);
  t.mock.method(AdvisorProfile, 'findOne', async () => null);
  t.mock.method(Review, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  const response = await new Promise((resolve, reject) => {
    const res = { status: (code) => { assert.equal(code, 200); return res; }, json: resolve };
    myAdvisorSessions({ user: { _id: session.advisor }, query: {} }, res, reject);
  });
  assert.equal(response.success, true);
  assert.equal(response.data.length, 1);
  assert.equal(response.data[0].status, 'completed');
  assert.equal(session.chargedAmount, 10);
  assert.equal(session.refundIssued, 10);
  assert.equal(saved, true);
  assert.equal(refund.mock.callCount(), 1);
  assert.equal(transactions.mock.calls[0].arguments[0].type, 'session_refund');
});
