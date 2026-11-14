import test from 'node:test';
import assert from 'node:assert/strict';
import User from '../models/user.model.js';
import Session from '../models/session.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import SessionSlotLock from '../models/sessionSlotLock.model.js';
import { rescheduleSession } from '../controllers/session.controller.js';

const invoke = (body = {}) => new Promise((resolve, reject) => {
  const res = { status: () => res, json: resolve };
  rescheduleSession({ params: { id: 'booking' }, user: { _id: 'seeker' }, body }, res, reject);
});

test('inactive or missing advisors cannot reschedule any unstarted booking or change slot locks', async (t) => {
  const session = {
    _id: 'booking', user: 'seeker', advisor: 'advisor', status: 'pending',
    scheduledFor: new Date('2026-12-01T10:00:00Z'),
    save: t.mock.fn(() => { throw new Error('Must not save'); })
  };
  let advisor;
  t.mock.method(Session, 'findById', async () => session);
  t.mock.method(User, 'findOne', (filter) => {
    assert.deepEqual(filter, { _id: 'advisor', role: 'advisor' });
    return { select: async () => advisor };
  });
  const profile = t.mock.method(AdvisorProfile, 'findOne', () => { throw new Error('Must reject before profile/slot checks'); });
  const locks = t.mock.method(SessionSlotLock, 'deleteMany', () => { throw new Error('Must retain slot locks'); });
  for (const bookingStatus of ['pending', 'consent', 'waiting']) {
    session.status = bookingStatus;
    for (const accountStatus of ['deactivated', 'suspended', 'pending_verification', null]) {
      advisor = accountStatus ? { status: accountStatus } : null;
      await assert.rejects(invoke({ newScheduledFor: '2026-12-02T10:00:00Z' }), {
        statusCode: 403, message: 'Advisor not available for rescheduling'
      });
      assert.equal(session.scheduledFor.toISOString(), '2026-12-01T10:00:00.000Z');
    }
  }
  assert.equal(session.save.mock.callCount(), 0);
  assert.equal(profile.mock.callCount(), 0);
  assert.equal(locks.mock.callCount(), 0);
});

test('reactivating an advisor lets rescheduling proceed to normal booking validation', async (t) => {
  let status = 'deactivated';
  t.mock.method(Session, 'findById', async () => ({ user: 'seeker', advisor: 'advisor', status: 'pending' }));
  t.mock.method(User, 'findOne', () => ({ select: async () => ({ status }) }));
  const profile = t.mock.method(AdvisorProfile, 'findOne', () => ({ populate: async () => ({}) }));
  await assert.rejects(invoke(), { statusCode: 403 });
  assert.equal(profile.mock.callCount(), 0);
  status = 'active';
  await assert.rejects(invoke(), { statusCode: 400, message: 'Booking time must include a UTC or timezone offset' });
  assert.equal(profile.mock.callCount(), 1);
});
