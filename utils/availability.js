// Availability helpers — shared by admin advisor listing and public browsing so
// "Available Now" means the same thing everywhere: the advisor is online AND the
// current moment falls inside that day's published schedule window (in their tz).

const toMinutes = (hhmm) => {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
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

// True when "now" is inside the advisor's schedule window for the current weekday.
// Supports overnight windows (e.g. 18:00 → 00:30) which the schedule UI allows.
export const isWithinSchedule = (weeklySchedule, timezone) => {
  if (!weeklySchedule) return false;
  const { weekday, minutes } = localParts(timezone);
  const day = weeklySchedule[weekday];
  if (!day || day.enabled === false) return false;
  const from = toMinutes(day.from);
  const to = toMinutes(day.to);
  if (from == null || to == null) return false;
  if (to <= from) return minutes >= from || minutes < to; // overnight
  return minutes >= from && minutes < to;
};

export default { isWithinSchedule };
