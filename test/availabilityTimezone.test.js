import test from 'node:test';
import assert from 'node:assert/strict';
import { convertAvailabilityTimezone, timezonePatch } from '../services/availabilityTimezone.service.js';

const convert = (input) => convertAvailabilityTimezone({
  fromTimezone: 'America/Chicago', toTimezone: 'Africa/Lagos', anchorDate: '2026-10-31', ...input
});

test('Chicago to Lagos preview converts weekly hours, date overrides and templates without mutating input', () => {
  const input = { weeklySchedule: { saturday: { enabled: true, slots: [{ from: '04:14', to: '10:00' }] } },
    dateAvailability: { '2026-10-31': { slots: [{ from: '04:14', to: '22:00' }] } },
    availabilityTemplates: [{ id: 'template', name: 'Week', weeklySchedule: { saturday: { enabled: true, from: '09:00', to: '10:00' } } }] };
  const before = structuredClone(input);
  const result = convert(input);
  assert.deepEqual(result.weeklySchedule.saturday.slots, [{ from: '10:14', to: '16:00' }]);
  assert.deepEqual(result.dateAvailability['2026-10-31'].slots, [{ from: '10:14', to: '00:00' }]);
  assert.deepEqual(result.dateAvailability['2026-11-01'].slots, [{ from: '00:00', to: '04:00' }]);
  assert.deepEqual(result.availabilityTemplates[0].weeklySchedule.saturday.slots, [{ from: '15:00', to: '16:00' }]);
  assert.deepEqual(input, before);
});

test('dated windows use their own DST offset rather than a fixed CST offset', () => {
  const result = convert({ dateAvailability: {
    '2026-07-15': { slots: [{ from: '09:00', to: '10:00' }] },
    '2026-12-15': { slots: [{ from: '09:00', to: '10:00' }] }
  } });
  assert.deepEqual(result.dateAvailability['2026-07-15'].slots, [{ from: '15:00', to: '16:00' }]);
  assert.deepEqual(result.dateAvailability['2026-12-15'].slots, [{ from: '16:00', to: '17:00' }]);
});

test('conversion preserves neighbouring weekly hours when a closed date shifts over midnight', () => {
  const result = convert({ weeklySchedule: {
    friday: { enabled: true, from: '20:00', to: '23:00' },
    sunday: { enabled: true, from: '09:00', to: '10:00' }
  }, dateAvailability: { '2026-10-31': { unavailable: true, slots: [] } } });
  assert.deepEqual(result.dateAvailability['2026-10-31'].slots, [{ from: '02:00', to: '05:00' }]);
  assert.deepEqual(result.dateAvailability['2026-11-01'].slots, [{ from: '16:00', to: '17:00' }]);
});

test('conversion moves weekday boundaries and rejects nonexistent source wall times', () => {
  const result = convert({ fromTimezone: 'Africa/Lagos', toTimezone: 'America/Chicago', weeklySchedule: {
    monday: { enabled: true, from: '02:00', to: '04:00' }
  } });
  assert.deepEqual(result.weeklySchedule.sunday.slots, [{ from: '20:00', to: '22:00' }]);
  assert.throws(() => convert({ dateAvailability: { '2026-03-08': { slots: [{ from: '02:30', to: '04:00' }] } } }), /does not exist/);
});

test('API migration converts older forms once and accepts already-converted previews without shifting twice', () => {
  const existing = { dateAvailability: { '2026-10-31': { slots: [{ from: '04:14', to: '10:00' }] } } };
  const first = timezonePatch(existing, {}, 'America/Chicago', 'Africa/Lagos');
  assert.deepEqual(first.dateAvailability['2026-10-31'].slots, [{ from: '10:14', to: '16:00' }]);
  const preview = { dateAvailability: first.dateAvailability };
  assert.deepEqual(timezonePatch(existing, preview, 'America/Chicago', 'Africa/Lagos', 'Africa/Lagos'), preview);
  assert.throws(() => timezonePatch(existing, {}, 'America/Chicago', 'Africa/Lagos', 'Asia/Dhaka'), /Reload/);
});
