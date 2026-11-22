import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Wallet from '../models/wallet.model.js';
import Session from '../models/session.model.js';
import SessionSlotLock from '../models/sessionSlotLock.model.js';
import Notification from '../models/notification.model.js';
import Transaction from '../models/transaction.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import {
  activateSessionIfReady,
  computeExtensionWindow,
  extendSession,
  sessionOccupiedRange
} from '../controllers/session.controller.js';

const MIN = 60 * 1000;
const recent = () => new Date(Date.now() - 2000);

const chain = (value) => {
  const query = {
    sort: () => query,
    limit: () => query,
    select: () => query,
    lean: async () => value,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
  };
  return query;
};

const makeSession = (overrides = {}) => {
  const doc = {
    _id: new mongoose.Types.ObjectId(),
    sessionCode: 'SES-654321',
    user: new mongoose.Types.ObjectId(),
    advisor: new mongoose.Types.ObjectId(),
    type: 'chat',
    status: 'live',
    scheduledFor: new Date(Date.now() - 10 * MIN),
    startedAt: new Date(Date.now() - 10 * MIN),
    durationMinutes: 15,
    ratePerMin: 2,
    estimatedCost: 30,
    holdAmount: 30,
    chargedAmount: 0,
    creditsUsed: 0,
    extensions: [],
    ...overrides
  };
  doc.save = async () => doc;
  doc.toObject = () => ({ ...doc });
  return doc;
};

const liveEnd = (session) => new Date(session.startedAt.getTime() + session.durationMinutes * MIN);

const mockCalendar = (t, { bookings = [], bufferMinutes = 0 } = {}) => {
  t.mock.method(Session, 'find', () => chain(bookings));
  t.mock.method(AdvisorProfile, 'findOne', () => chain({ availabilitySettings: { bufferMinutes } }));
};

const mockWallet = (t, { balance = 100, freeCredits = 0 } = {}) => {
  const wallet = { _id: new mongoose.Types.ObjectId(), balance, freeCredits };
  t.mock.method(Wallet, 'findOne', () => {
    const result = Promise.resolve(wallet);
    result.lean = async () => wallet;
    return result;
  });
  return t.mock.method(Wallet, 'findOneAndUpdate', async () => ({ ...wallet }));
};

const callController = (handler, req) =>
  new Promise((resolve, reject) => {
    const res = { status: () => res, json: resolve };
    handler({ app: { get: () => null }, ...req }, res, reject);
  });

// ---------- occupied range ----------

test('a late-started session occupies the calendar until its live end', () => {
  const scheduledFor = new Date('2026-11-22T10:00:00Z');
  const range = sessionOccupiedRange({
    scheduledFor,
    startedAt: new Date('2026-11-22T10:08:00Z'),
    durationMinutes: 15
  });
  assert.equal(range.start.toISOString(), '2026-11-22T10:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-11-22T10:23:00.000Z');
});

test('a booking that has not started occupies exactly its booked slot', () => {
  const range = sessionOccupiedRange({ scheduledFor: new Date('2026-11-22T10:00:00Z'), durationMinutes: 30 });
  assert.equal(range.end.toISOString(), '2026-11-22T10:30:00.000Z');
});

// ---------- extension window ----------

test('extension is available up to the maximum when the advisor has no next appointment', async (t) => {
  const session = makeSession();
  mockCalendar(t);
  const window = await computeExtensionWindow(session);
  assert.equal(window.available, true);
  assert.equal(window.maxMinutes, 60);
  assert.equal(window.nextBookingAt, null);
});

test('extension is disabled when the next appointment starts right after the session', async (t) => {
  const session = makeSession();
  mockCalendar(t, { bookings: [{ scheduledFor: liveEnd(session), durationMinutes: 15, status: 'pending' }] });
  const window = await computeExtensionWindow(session);
  assert.equal(window.available, false);
  assert.equal(window.maxMinutes, 0);
});

test('extension is limited to the free time before the next appointment', async (t) => {
  const session = makeSession();
  const next = new Date(liveEnd(session).getTime() + 7 * MIN);
  mockCalendar(t, { bookings: [{ scheduledFor: next, durationMinutes: 15, status: 'pending' }] });
  const window = await computeExtensionWindow(session);
  assert.equal(window.available, true);
  assert.equal(window.maxMinutes, 7);
  assert.equal(window.nextBookingAt.toISOString(), next.toISOString());
});

test('the advisor buffer is kept free when extending', async (t) => {
  const session = makeSession();
  const next = new Date(liveEnd(session).getTime() + 7 * MIN);
  mockCalendar(t, { bookings: [{ scheduledFor: next, durationMinutes: 15 }], bufferMinutes: 5 });
  const window = await computeExtensionWindow(session);
  assert.equal(window.maxMinutes, 2);
});

test('a stale booking whose window already passed does not block extension', async (t) => {
  const session = makeSession();
  mockCalendar(t, {
    bookings: [{ scheduledFor: new Date(Date.now() - 2 * MIN), durationMinutes: 1, status: 'pending' }]
  });
  const window = await computeExtensionWindow(session);
  assert.equal(window.available, true);
  assert.equal(window.maxMinutes, 60);
});

test('a session that is not live cannot be extended', async () => {
  const window = await computeExtensionWindow(makeSession({ status: 'waiting', startedAt: undefined }));
  assert.equal(window.available, false);
});

// ---------- extend endpoint ----------

test('extend is refused when the advisor has an appointment immediately after', async (t) => {
  const session = makeSession();
  t.mock.method(Session, 'findById', async () => session);
  mockCalendar(t, { bookings: [{ scheduledFor: liveEnd(session), durationMinutes: 15 }] });
  const update = t.mock.method(Session, 'findOneAndUpdate', async () => null);
  const locks = t.mock.method(SessionSlotLock, 'insertMany', async () => []);

  await assert.rejects(
    callController(extendSession, {
      params: { id: String(session._id) },
      body: { minutes: 5 },
      user: { _id: session.user }
    }),
    /another appointment right after/i
  );
  assert.equal(update.mock.callCount(), 0);
  assert.equal(locks.mock.callCount(), 0);
});

test('extend is refused when the request does not fit before the next appointment', async (t) => {
  const session = makeSession();
  t.mock.method(Session, 'findById', async () => session);
  mockCalendar(t, { bookings: [{ scheduledFor: new Date(liveEnd(session).getTime() + 7 * MIN), durationMinutes: 15 }] });
  const update = t.mock.method(Session, 'findOneAndUpdate', async () => null);

  await assert.rejects(
    callController(extendSession, {
      params: { id: String(session._id) },
      body: { minutes: 10 },
      user: { _id: session.user }
    }),
    /Only 7 more minutes/
  );
  assert.equal(update.mock.callCount(), 0);
});

test('extend within the free time locks the added minutes and extends the session', async (t) => {
  const session = makeSession();
  t.mock.method(Session, 'findById', async () => session);
  mockCalendar(t, { bookings: [{ scheduledFor: new Date(liveEnd(session).getTime() + 7 * MIN), durationMinutes: 15 }] });
  mockWallet(t);
  t.mock.method(SessionSlotLock, 'find', () => chain([]));
  const locks = t.mock.method(SessionSlotLock, 'insertMany', async (docs) => docs);
  t.mock.method(Notification, 'create', async (n) => ({ _id: new mongoose.Types.ObjectId(), ...n }));
  const update = t.mock.method(Session, 'findOneAndUpdate', async (filter, change) => {
    assert.equal(filter.durationMinutes, 15, 'guarded against a concurrent change');
    assert.equal(change.$set.durationMinutes, 20);
    return makeSession({ ...session, durationMinutes: 20 });
  });

  const response = await callController(extendSession, {
    params: { id: String(session._id) },
    body: { minutes: 5 },
    user: { _id: session.user }
  });

  assert.equal(response.data.durationMinutes, 20);
  assert.equal(update.mock.callCount(), 1);
  const lockedDocs = locks.mock.calls[0].arguments[0];
  assert.ok(lockedDocs.length >= 5 && lockedDocs.length <= 6, 'the extra minutes are locked');
  assert.ok(lockedDocs.every((doc) => doc.slotStart >= new Date(liveEnd(session).getTime() - MIN)));
});

test('extend rejects invalid minute values', async (t) => {
  const session = makeSession();
  t.mock.method(Session, 'findById', async () => session);
  for (const minutes of [0, -5, 2.5, 'abc', 61]) {
    await assert.rejects(
      callController(extendSession, {
        params: { id: String(session._id) },
        body: { minutes },
        user: { _id: session.user }
      }),
      /Invalid minutes/
    );
  }
});

// ---------- late start must not run into the next appointment ----------

const readySession = (overrides = {}) => makeSession({
  status: 'waiting',
  startedAt: undefined,
  advisorReadyAt: recent(),
  advisorPresentAt: recent(),
  userPresentAt: recent(),
  ...overrides
});

test('a late start is shortened so it ends before the advisor next appointment', async (t) => {
  const session = readySession();
  mockCalendar(t, { bookings: [{ scheduledFor: new Date(Date.now() + 5.5 * MIN), durationMinutes: 15 }] });
  mockWallet(t);
  t.mock.method(Transaction, 'create', async () => ({}));
  t.mock.method(Notification, 'create', async (n) => ({ _id: new mongoose.Types.ObjectId(), ...n }));
  let liveSet;
  t.mock.method(Session, 'findOneAndUpdate', async (filter, update) => {
    liveSet = update.$set;
    return makeSession({ ...session, ...update.$set });
  });
  t.mock.method(Session, 'findById', async () => makeSession({ ...session, ...liveSet }));

  const result = await activateSessionIfReady(session, null);

  assert.equal(result.activated, true);
  assert.equal(liveSet.durationMinutes, 5);
  assert.equal(liveSet.bookedDurationMinutes, 15);
});

test('a session does not start when no time is left before the next appointment', async (t) => {
  const session = readySession();
  mockCalendar(t, { bookings: [{ scheduledFor: new Date(Date.now() + 30 * 1000), durationMinutes: 15 }] });
  const claim = t.mock.method(Session, 'findOneAndUpdate', async () => null);
  const charge = mockWallet(t);

  const result = await activateSessionIfReady(session, null);

  assert.equal(result.activated, false);
  assert.equal(result.blockedByNextBooking, true);
  assert.equal(claim.mock.callCount(), 0);
  assert.equal(charge.mock.callCount(), 0);
});
