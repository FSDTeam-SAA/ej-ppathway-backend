import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User from '../models/user.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import Session from '../models/session.model.js';
import { saveAvailabilityTimezone } from '../services/saveAvailabilityTimezone.service.js';

for (const failProfile of [false, true]) {
  test(`timezone and schedule ${failProfile ? 'roll back together on a failed write' : 'commit together without touching booked sessions'}`, async t => {
    let saved = { timezone: 'America/Chicago', from: '04:14' };
    let closed = false;
    t.mock.method(mongoose, 'startSession', async () => {
      const session = { state: null, endSession: async () => { closed = true; }, withTransaction: async work => {
        session.state = { ...saved };
        await work();
        saved = session.state;
      } };
      return session;
    });
    t.mock.method(User, 'findOneAndUpdate', async (filter, update, options) => {
      assert.equal(filter.timezone, 'America/Chicago');
      options.session.state.timezone = update.$set.timezone;
      return { _id: 'advisor', timezone: update.$set.timezone };
    });
    t.mock.method(AdvisorProfile, 'findOneAndUpdate', async (_, update, options) => {
      if (failProfile) throw new Error('simulated database failure');
      options.session.state.from = update.$set.from;
      return { from: update.$set.from };
    });
    const sessions = t.mock.method(Session, 'updateMany', async () => { throw new Error('must not change appointments'); });
    const promise = saveAvailabilityTimezone({ userId: 'advisor', previousTimezone: 'America/Chicago',
      userPatch: { timezone: 'Africa/Lagos' }, profilePatch: { from: '10:14' } });
    if (failProfile) {
      await assert.rejects(promise, /simulated database failure/);
      assert.deepEqual(saved, { timezone: 'America/Chicago', from: '04:14' });
    } else {
      await promise;
      assert.deepEqual(saved, { timezone: 'Africa/Lagos', from: '10:14' });
    }
    assert.equal(closed, true);
    assert.equal(sessions.mock.callCount(), 0);
  });
}
