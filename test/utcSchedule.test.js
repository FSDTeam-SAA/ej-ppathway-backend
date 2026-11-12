import test from 'node:test';
import assert from 'node:assert/strict';
import User from '../models/user.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import Session from '../models/session.model.js';
import { buildAdvisorAvailability, advisorUtcSchedule } from '../controllers/session.controller.js';

function setup(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-11T00:00Z') });
  const advisor = { _id: 'advisor', timezone: 'Africa/Lagos', name: 'Advisor' };
  const profile = { user: advisor, weeklySchedule: {}, dateAvailability: {
    '2026-11-12': { slots: [{ from: '03:23', to: '05:00' }, { from: '05:00', to: '06:00' }] }
  } };
  t.mock.method(User, 'findOne', () => ({ select: async () => advisor }));
  t.mock.method(AdvisorProfile, 'findOne', () => ({ populate: async () => profile }));
  return profile;
}

test('UTC schedule and booking keep Lagos instants and the Chicago previous-day conversion', async (t) => {
  setup(t);
  t.mock.method(Session, 'find', () => ({ populate: () => ({ sort: async () => [] }) }));
  const utc = await buildAdvisorAvailability({ advisorId: 'advisor', date: '2026-11-12', durationMinutes: 5, viewerTimezone: 'UTC' });
  const chicago = await buildAdvisorAvailability({ advisorId: 'advisor', date: '2026-11-11', durationMinutes: 5, viewerTimezone: 'America/Chicago' });
  assert.deepEqual(utc.scheduleIntervals, [{ start: '2026-11-12T02:23:00.000Z', end: '2026-11-12T05:00:00.000Z' }]);
  assert.deepEqual(chicago.availableSlots.map(s => s.start), utc.availableSlots.map(s => s.start));
  assert.equal(utc.availableSlots[0].start, '2026-11-12T02:23:00.000Z');
  assert.equal(chicago.availableSlots[0].startLabel, '8:23 PM');
});

test('public UTC schedule never reads or exposes bookings', async (t) => {
  const profile = setup(t);
  profile.dateAvailability['2026-11-12'].slots = [{ from: '00:30', to: '02:00' }];
  const bookings = t.mock.method(Session, 'find', () => { throw new Error('Public schedule must not read bookings'); });
  const response = await new Promise((resolve, reject) => {
    const res = { status: () => res, json: resolve };
    advisorUtcSchedule({ params: { advisorId: 'advisor' }, query: { date: '2026-11-11' } }, res, reject);
  });
  assert.equal(bookings.mock.callCount(), 0);
  assert.deepEqual(response.data.bookedSlots, []);
  assert.deepEqual(response.data.availableSlots, []);
  assert.deepEqual(response.data.scheduleIntervals, [{ start: '2026-11-11T23:30:00.000Z', end: '2026-11-12T00:00:00.000Z' }]);
});

test('public schedule follows the viewer local day, including offset fallback', async (t) => {
  setup(t);
  t.mock.method(Session, 'find', () => { throw new Error('Must not read bookings'); });
  const request = async (query) => new Promise((resolve, reject) => {
    const res = { status: () => res, json: resolve };
    advisorUtcSchedule({ params: { advisorId: 'advisor' }, query }, res, reject);
  });
  const chicago = await request({ date: '2026-11-11', viewerTimezone: 'America/Chicago' });
  assert.equal(chicago.data.displayTimezone, 'America/Chicago');
  assert.deepEqual(chicago.data.scheduleIntervals, [{ start: '2026-11-12T02:23:00.000Z', end: '2026-11-12T05:00:00.000Z' }]);
  const dhaka = await request({ date: '2026-11-12', viewerTimezone: 'Asia/Dhaka' });
  assert.deepEqual(dhaka.data.scheduleIntervals, chicago.data.scheduleIntervals);
  const fallback = await request({ date: '2026-11-11', timezoneOffsetMinutes: '-360' });
  assert.deepEqual(fallback.data.scheduleIntervals, chicago.data.scheduleIntervals);
});
