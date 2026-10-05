import test from 'node:test';
import assert from 'node:assert/strict';
import User from '../models/user.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import Session from '../models/session.model.js';
import { buildAdvisorAvailability, intervalFitsAvailability, resolveAdvisorTimezone } from '../controllers/session.controller.js';
import { requireTimezone } from '../utils/timezone.js';

test('timezone names are validated and explicit UTC is respected', () => {
  for (const zone of ['Africa/Lagos', 'Africa/Johannesburg', 'Africa/Nairobi', 'Africa/Accra', 'Africa/Cairo', 'Asia/Dhaka']) assert.equal(requireTimezone(zone), zone);
  assert.throws(() => requireTimezone('Africa/Invalid'), /IANA timezone/);
  assert.equal(resolveAdvisorTimezone({ country: 'BD', timezone: 'UTC' }), 'UTC');
});

test('schedule intervals honor overnight date overrides and DST gaps', () => {
  const overnight = { weeklySchedule: { monday: { enabled: true, from: '23:00', to: '01:00' } } };
  assert.equal(intervalFitsAvailability(overnight, new Date('2026-10-05T22:55Z'), 10, 'Africa/Lagos'), true);
  overnight.dateAvailability = { '2026-10-05': { unavailable: true } };
  assert.equal(intervalFitsAvailability(overnight, new Date('2026-10-05T23:15Z'), 5, 'Africa/Lagos'), false);
  const dst = { weeklySchedule: { sunday: { enabled: true, from: '01:00', to: '04:00' } } };
  assert.equal(intervalFitsAvailability(dst, new Date('2026-03-08T06:55Z'), 10, 'America/New_York'), true);
  dst.weeklySchedule.sunday.to = '02:30';
  assert.equal(intervalFitsAvailability(dst, new Date('2026-03-08T06:55Z'), 10, 'America/New_York'), false);
});

test('African schedules return viewer-local days, exact UTC slots, and adjacent booking availability', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T00:00Z') });
  const advisor = { _id: 'advisor', timezone: 'Africa/Lagos', name: 'Advisor' };
  const profile = { user: advisor, weeklySchedule: { monday: { enabled: true, from: '09:00', to: '17:00' } }, sessionTypes: { chat: false, call: true } };
  const booked = [{ scheduledFor: new Date('2026-10-05T15:15Z'), durationMinutes: 5, type: 'call', status: 'pending', _id: 'booked' }];
  t.mock.method(User, 'findOne', () => ({ select: async () => advisor }));
  t.mock.method(AdvisorProfile, 'findOne', () => ({ populate: async () => profile }));
  t.mock.method(Session, 'find', () => ({ populate: () => ({ sort: async () => booked }) }));
  const result = await buildAdvisorAvailability({ advisorId: 'advisor', date: '2026-10-05', durationMinutes: 5, viewerTimezone: 'Asia/Dhaka', viewerOffsetMinutes: 0 });
  assert.equal(result.availableSlots[0].start, '2026-10-05T08:00:00.000Z');
  assert.equal(result.availableSlots[0].startLabel, '2:00 PM');
  assert.equal(result.displayTimezone, 'Asia/Dhaka');
  const starts = result.availableSlots.map(s => s.start);
  assert.equal(starts.includes('2026-10-05T15:15:00.000Z'), false);
  assert.equal(starts.includes('2026-10-05T15:20:00.000Z'), true);
  profile.availabilitySettings = { bufferMinutes: 5 };
  const buffered = await buildAdvisorAvailability({ advisorId: 'advisor', date: '2026-10-05', durationMinutes: 5, viewerTimezone: 'Africa/Lagos' });
  assert.equal(buffered.availableSlots.some(s => s.start === '2026-10-05T15:20:00.000Z'), false);
  assert.equal(buffered.availableSlots.some(s => s.start === '2026-10-05T15:25:00.000Z'), true);
  // A Los Angeles Sunday can include the advisor's Monday override.
  profile.availabilitySettings = {};
  profile.dateAvailability = { '2026-10-05': { slots: [{ from: '00:05', to: '00:15' }] } };
  const previousDate = await buildAdvisorAvailability({ advisorId: 'advisor', date: '2026-10-04', durationMinutes: 5, viewerTimezone: 'America/Los_Angeles' });
  assert.equal(previousDate.availableSlots[0].start, '2026-10-04T23:05:00.000Z');
  assert.equal(previousDate.availableSlots[0].startLabel, '4:05 PM');
  const disabled = await buildAdvisorAvailability({ advisorId: 'advisor', date: '2026-10-04', durationMinutes: 5, viewerTimezone: 'America/Los_Angeles', type: 'chat' });
  assert.equal(disabled.availableSlots.length, 0);
  await assert.rejects(buildAdvisorAvailability({ advisorId: 'advisor', date: '2026-02-30', durationMinutes: 5 }), /Invalid availability date/);
});
