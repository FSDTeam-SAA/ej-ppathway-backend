import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Wallet from '../models/wallet.model.js';
import Session from '../models/session.model.js';
import Transaction from '../models/transaction.model.js';
import Notification from '../models/notification.model.js';
import {
  activateSessionIfReady,
  advisorStartSession,
  sessionHeartbeat
} from '../controllers/session.controller.js';

const recent = () => new Date(Date.now() - 2000);

const chatSession = (overrides = {}) => {
  const doc = {
    _id: new mongoose.Types.ObjectId(),
    sessionCode: 'SES-123456',
    user: new mongoose.Types.ObjectId(),
    advisor: new mongoose.Types.ObjectId(),
    type: 'chat',
    status: 'waiting',
    scheduledFor: new Date(Date.now() - 60 * 1000),
    durationMinutes: 15,
    ratePerMin: 2,
    estimatedCost: 30,
    holdAmount: 30,
    chargedAmount: 0,
    creditsUsed: 0,
    ...overrides
  };
  doc.save = async () => doc;
  doc.toObject = () => ({ ...doc });
  return doc;
};

const callController = (handler, req) =>
  new Promise((resolve, reject) => {
    const res = { status: () => res, json: resolve };
    handler({ app: { get: () => null }, ...req }, res, reject);
  });

const mockWallet = (t, { balance = 100, freeCredits = 0 } = {}) => {
  const wallet = { _id: new mongoose.Types.ObjectId(), balance, freeCredits };
  t.mock.method(Wallet, 'findOne', (filter) => {
    const result = Promise.resolve(wallet);
    result.lean = async () => wallet;
    return result;
  });
  return t.mock.method(Wallet, 'findOneAndUpdate', async () => ({ ...wallet }));
};

test('advisor start marks the advisor ready without charging or starting the timer', async (t) => {
  const session = chatSession({ status: 'consent' });
  t.mock.method(Session, 'findById', async () => session);
  const claim = t.mock.method(Session, 'findOneAndUpdate', async () => null);
  const charge = mockWallet(t);
  t.mock.method(Notification, 'create', async (n) => ({ _id: new mongoose.Types.ObjectId(), ...n }));

  const response = await callController(advisorStartSession, {
    params: { id: String(session._id) },
    user: { _id: session.advisor }
  });

  assert.equal(response.data.status, 'waiting');
  assert.ok(response.data.advisorReadyAt);
  assert.equal(response.data.startedAt, undefined);
  assert.equal(charge.mock.callCount(), 0, 'no credits charged on advisor start');
  assert.equal(claim.mock.callCount(), 0, 'session not claimed live while the user is absent');
});

test('advisor start refuses when the user cannot cover the first minute', async (t) => {
  const session = chatSession();
  t.mock.method(Session, 'findById', async () => session);
  mockWallet(t, { balance: 1 });
  await assert.rejects(
    callController(advisorStartSession, {
      params: { id: String(session._id) },
      user: { _id: session.advisor }
    }),
    /insufficient funds/i
  );
  assert.equal(session.advisorReadyAt, undefined);
});

test('session stays in waiting while only the advisor is present', async (t) => {
  const session = chatSession({ advisorReadyAt: recent(), advisorPresentAt: recent() });
  const claim = t.mock.method(Session, 'findOneAndUpdate', async () => null);
  const charge = mockWallet(t);
  const result = await activateSessionIfReady(session, null);
  assert.equal(result.activated, false);
  assert.equal(claim.mock.callCount(), 0);
  assert.equal(charge.mock.callCount(), 0);
});

test('session does not go live when the user is present but the advisor has not started', async (t) => {
  const session = chatSession({ userPresentAt: recent(), advisorPresentAt: recent() });
  const claim = t.mock.method(Session, 'findOneAndUpdate', async () => null);
  const result = await activateSessionIfReady(session, null);
  assert.equal(result.activated, false);
  assert.equal(claim.mock.callCount(), 0);
});

test('a stale advisor presence does not start the session', async (t) => {
  const session = chatSession({
    advisorReadyAt: new Date(Date.now() - 5 * 60 * 1000),
    advisorPresentAt: new Date(Date.now() - 5 * 60 * 1000),
    userPresentAt: recent()
  });
  const claim = t.mock.method(Session, 'findOneAndUpdate', async () => null);
  const result = await activateSessionIfReady(session, null);
  assert.equal(result.activated, false);
  assert.equal(claim.mock.callCount(), 0);
});

test('session goes live and charges the first minute once both are connected', async (t) => {
  const session = chatSession({ advisorReadyAt: recent(), advisorPresentAt: recent(), userPresentAt: recent() });
  const live = chatSession({ ...session, status: 'live', startedAt: new Date() });
  const claim = t.mock.method(Session, 'findOneAndUpdate', async (filter, update) => {
    assert.deepEqual(update.$set.status, 'live');
    assert.ok(update.$set.startedAt instanceof Date);
    return live;
  });
  t.mock.method(Session, 'findById', async () => live);
  const charge = mockWallet(t);
  const tx = t.mock.method(Transaction, 'create', async () => ({}));
  t.mock.method(Notification, 'create', async (n) => ({ _id: new mongoose.Types.ObjectId(), ...n }));

  const result = await activateSessionIfReady(session, null);

  assert.equal(result.activated, true);
  assert.equal(result.session.status, 'live');
  assert.equal(claim.mock.callCount(), 1);
  assert.equal(charge.mock.callCount(), 1, 'first-minute hold charged exactly once');
  assert.equal(live.chargedAmount, 2);
  assert.equal(tx.mock.callCount(), 1);
});

test('heartbeat before go-live records presence and never charges', async (t) => {
  const session = chatSession({ advisorReadyAt: recent(), advisorPresentAt: recent() });
  t.mock.method(Session, 'findById', async () => session);
  const presence = t.mock.method(Session, 'updateOne', async () => ({}));
  t.mock.method(Session, 'findOneAndUpdate', async () => null);
  const charge = mockWallet(t);

  const response = await callController(sessionHeartbeat, {
    params: { id: String(session._id) },
    user: { _id: session.advisor }
  });

  assert.equal(response.data.waiting, true);
  assert.equal(response.data.ended, false);
  assert.equal(charge.mock.callCount(), 0);
  assert.ok(presence.mock.calls[0].arguments[1].$set.advisorPresentAt instanceof Date);
});
