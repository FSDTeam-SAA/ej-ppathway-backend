import ApiError from '../utils/ApiError.js';
import { requireTimezone } from '../utils/timezone.js';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY = 86400000;
const fail = (message) => new ApiError(400, message);
const datePlus = (key, days) => new Date(Date.parse(`${key}T12:00Z`) + days * DAY).toISOString().slice(0, 10);
const weekday = (key) => DAYS[new Date(`${key}T12:00Z`).getUTCDay()];

// One conversion engine serves both dashboards and older API clients. Stored
// bookings are deliberately outside this service: their UTC instants never move.
export const convertAvailabilityTimezone = ({ fromTimezone, toTimezone, weeklySchedule = {}, dateAvailability = {}, availabilityTemplates = [], anchorDate }) => {
  const from = requireTimezone(fromTimezone);
  const to = requireTimezone(toTimezone);
  const rules = dateAvailability instanceof Map ? Object.fromEntries(dateAvailability) : dateAvailability;
  if (!rules || typeof rules !== 'object' || Object.keys(rules).length > 1000) throw fail('Too many date overrides');
  if (!Array.isArray(availabilityTemplates) || availabilityTemplates.length > 100) throw fail('Too many availability templates');
  const formatters = new Map();
  const parts = (ms, zone) => {
    if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }));
    const p = Object.fromEntries(formatters.get(zone).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  };
  const cache = new Map();
  const instant = (date, time, zone, end = false) => {
    const key = `${date}|${time}|${zone}|${end}`;
    if (cache.has(key)) return cache.get(key);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw fail('Invalid availability date or time');
    const nominal = Date.parse(`${date}T${time}:00Z`);
    if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0, 10) !== date) throw fail('Invalid availability date');
    const offsets = new Set([-36, 0, 36].map(hours => {
      const probe = nominal + hours * 3600000;
      const p = parts(probe, zone);
      return Date.parse(`${p.date}T${p.time}:00Z`) - probe;
    }));
    const matches = [...offsets].map(offset => nominal - offset).filter(ms => {
      const p = parts(ms, zone); return p.date === date && p.time === time;
    }).sort((a, b) => a - b);
    if (!matches.length) throw fail(`${date} ${time} does not exist in ${zone} because of a clock change. Adjust that window before converting.`);
    const result = end ? matches.at(-1) : matches[0];
    cache.set(key, result);
    return result;
  };
  const slots = (day, dated = false) => {
    if (!day || (dated ? day.unavailable === true : day.enabled === false)) return [];
    if (day.slots != null && !Array.isArray(day.slots)) throw fail('Invalid availability windows');
    return day.slots?.length ? day.slots : !dated && day.from && day.to ? [{ from: day.from, to: day.to }] : [];
  };
  const range = (date, slot) => ({
    start: instant(date, slot.from, from),
    end: instant(slot.to <= slot.from ? datePlus(date, 1) : date, slot.to, from, true)
  });
  const split = ({ start, end }) => {
    const result = [];
    for (let cursor = start; cursor < end;) {
      const p = parts(cursor, to);
      const next = instant(datePlus(p.date, 1), '00:00', to);
      const boundary = Math.min(next, end);
      result.push({ date: p.date, from: p.time, to: boundary === next ? '00:00' : parts(boundary, to).time });
      cursor = boundary;
    }
    return result;
  };
  const unique = list => [...new Map(list.map(s => [`${s.from}-${s.to}`, { from: s.from, to: s.to }])).values()].sort((a,b) => a.from.localeCompare(b.from));
  const anchor = anchorDate || parts(Date.now(), from).date;
  instant(anchor, '12:00', from);
  const sunday = datePlus(anchor, -new Date(`${anchor}T12:00Z`).getUTCDay());
  const weekly = (source) => {
    const grouped = Object.fromEntries(DAYS.map(d => [d, []]));
    for (let i = 0; i < 7; i++) {
      const date = datePlus(sunday, i);
      for (const slot of slots(source?.[weekday(date)])) {
        for (const segment of split(range(date, slot))) grouped[weekday(segment.date)].push(segment);
      }
    }
    return Object.fromEntries(DAYS.map(day => {
      const windows = unique(grouped[day]);
      return [day, { enabled: windows.length > 0, from: windows[0]?.from || '09:00', to: windows[0]?.to || '18:00', slots: windows }];
    }));
  };
  // A shifted override can affect two target dates. Reconstruct both dates from
  // their effective source-day windows, including neighbouring weekly hours,
  // so a closed date or overnight override never erases an unrelated half-day.
  const affected = new Set();
  for (const date of Object.keys(rules)) {
    const start = instant(date, '00:00', from);
    const end = instant(datePlus(date, 1), '00:00', from);
    for (const segment of split({ start, end })) affected.add(segment.date);
    for (const slot of slots(rules[date], true)) for (const segment of split(range(date, slot))) affected.add(segment.date);
  }
  const convertedRules = {};
  for (const targetDate of affected) {
    const start = instant(targetDate, '00:00', to);
    const end = instant(datePlus(targetDate, 1), '00:00', to);
    const sourceDate = parts(start, from).date;
    const windows = [];
    for (let i = -2; i <= 3; i++) {
      const date = datePlus(sourceDate, i);
      const hasRule = Object.hasOwn(rules, date);
      for (const slot of slots(hasRule ? rules[date] : weeklySchedule?.[weekday(date)], hasRule)) {
        const r = range(date, slot);
        // An explicit next-day rule overrides an overnight carry-in.
        if (slot.to <= slot.from && Object.hasOwn(rules, datePlus(date, 1))) r.end = Math.min(r.end, instant(datePlus(date, 1), '00:00', from));
        const clipped = { start: Math.max(start, r.start), end: Math.min(end, r.end) };
        if (clipped.start < clipped.end) windows.push(...split(clipped));
      }
    }
    const converted = unique(windows);
    convertedRules[targetDate] = { unavailable: converted.length === 0, slots: converted };
  }
  return {
    timezone: to, availabilityTimezone: to, referenceDate: anchor,
    weeklySchedule: weekly(weeklySchedule), dateAvailability: convertedRules,
    availabilityTemplates: availabilityTemplates.map(template => ({ ...template, weeklySchedule: weekly(template.weeklySchedule) }))
  };
};

// A form may already contain a server-generated preview in the new timezone.
// Older forms contain the original wall-clock values and need conversion here.
export const timezonePatch = (existing, patch, oldTimezone, newTimezone, submittedTimezone) => {
  if (!newTimezone || newTimezone === oldTimezone) return patch;
  if (submittedTimezone && submittedTimezone !== oldTimezone && submittedTimezone !== newTimezone) throw new ApiError(409, 'Availability timezone changed. Reload the profile before saving.');
  if (submittedTimezone === newTimezone) {
    if (patch.availabilityTemplates !== undefined || !existing.availabilityTemplates?.length) return patch;
    const templates = convertAvailabilityTimezone({ fromTimezone: oldTimezone || 'UTC', toTimezone: newTimezone, availabilityTemplates: existing.availabilityTemplates });
    return { ...patch, availabilityTemplates: templates.availabilityTemplates };
  }
  const converted = convertAvailabilityTimezone({ ...existing, ...patch, fromTimezone: oldTimezone || 'UTC', toTimezone: newTimezone });
  return { ...patch, weeklySchedule: converted.weeklySchedule, dateAvailability: converted.dateAvailability, availabilityTemplates: converted.availabilityTemplates };
};
