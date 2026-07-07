// Availability helpers — shared by admin advisor listing and public browsing so
// "Available Now" means the same thing everywhere: the advisor is online AND the
// current moment falls inside that day's published schedule window (in their tz).

const toMinutes = (hhmm) => {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

const scheduleSlots = (day) => {
  if (!day || day.enabled === false) return [];
  const rawSlots = Array.isArray(day.slots) && day.slots.length
    ? day.slots
    : [{ from: day.from, to: day.to }];
  return rawSlots
    .map((slot) => ({
      from: toMinutes(slot?.from || '09:00'),
      to: toMinutes(slot?.to || '18:00')
    }))
    .filter((slot) => slot.from !== null && slot.to !== null);
};

const dateAvailabilityEntry = (dateAvailability, dateKey) => {
  if (!dateAvailability || !dateKey) return null;
  if (dateAvailability instanceof Map) return dateAvailability.get(dateKey) || null;
  return dateAvailability[dateKey] || null;
};

const dateAvailabilitySlots = (day) => {
  if (!day || day.unavailable === true) return [];
  return (Array.isArray(day.slots) ? day.slots : [])
    .map((slot) => ({
      from: toMinutes(slot?.from),
      to: toMinutes(slot?.to)
    }))
    .filter((slot) => slot.from !== null && slot.to !== null);
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const previousWeekday = (weekday) => {
  const index = WEEKDAYS.indexOf(weekday);
  return WEEKDAYS[(index + 6) % 7] || weekday;
};

const slotContains = (slot, minutes, { previousDay = false } = {}) => {
  if (slot.to <= slot.from) {
    return previousDay ? minutes < slot.to : minutes >= slot.from;
  }
  return !previousDay && minutes >= slot.from && minutes < slot.to;
};

// Resolve the advisor's local weekday + minutes-of-day for an IANA timezone.
const localParts = (timezone) => {
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }
  const parts = fmt.formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const weekday = (get('weekday') || '').toLowerCase();
  let hour = parseInt(get('hour'), 10);
  if (hour === 24 || Number.isNaN(hour)) hour = 0; // some runtimes emit 24 at midnight
  const minute = parseInt(get('minute'), 10) || 0;
  return { weekday, minutes: hour * 60 + minute };
};

const localDateKey = (timezone) => {
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  } catch {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }
  const parts = fmt.formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};

// True when "now" is inside the advisor's schedule window for the current weekday.
// Supports overnight windows (e.g. 18:00 → 00:30) which the schedule UI allows.
export const isWithinSchedule = (weeklySchedule, timezone, dateAvailability) => {
  if (!weeklySchedule) return false;
  const { weekday, minutes } = localParts(timezone);
  const todayRule = dateAvailabilityEntry(dateAvailability, localDateKey(timezone));
  if (todayRule) {
    return dateAvailabilitySlots(todayRule).some((slot) => slotContains(slot, minutes));
  }
  if (scheduleSlots(weeklySchedule[weekday]).some((slot) => slotContains(slot, minutes))) {
    return true;
  }
  return scheduleSlots(weeklySchedule[previousWeekday(weekday)]).some((slot) =>
    slot.to <= slot.from && slotContains(slot, minutes, { previousDay: true })
  );
};

export default { isWithinSchedule };
