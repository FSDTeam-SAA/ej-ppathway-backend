// Named zones retain historical and future offset rules; never infer them from country.
export const isValidTimezone = (value) => {
  if (typeof value !== 'string' || !value.trim()) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value.trim() }); return true; }
  catch { return false; }
};

export const requireTimezone = (value, label = 'Timezone') => {
  if (!isValidTimezone(value)) {
    throw Object.assign(new Error(`${label} must be a valid IANA timezone`), { statusCode: 400 });
  }
  return value.trim();
};
