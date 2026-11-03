import crypto from 'node:crypto';

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const key = () => (process.env.FLUTTERWAVE_SECRET_KEY || '').trim();
export const flutterwaveTestMode = () => key().startsWith('FLWSECK_TEST-');
export const flutterwaveConfigured = () => Boolean(key() && process.env.FLUTTERWAVE_WEBHOOK_SECRET?.trim());
export const flutterwaveEnabled = () => process.env.FLUTTERWAVE_ENABLED === 'true' && flutterwaveConfigured();
export const isAllowedFlutterwaveCheckoutUrl = (value, { testMode = flutterwaveTestMode() } = {}) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    return /(^|\.)flutterwave\.com$/.test(url.hostname) ||
      (testMode && url.hostname === 'checkout-v2.dev-flutterwave.com');
  } catch { return false; }
};
export const flutterwaveSecretMatches = (received) => {
  const expected = Buffer.from(process.env.FLUTTERWAVE_WEBHOOK_SECRET?.trim() || '');
  const actual = Buffer.from(String(received || ''));
  return expected.length > 0 && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};
export const flutterwaveRequest = async (path, { body, allowNotFound = false, allowInactiveLink = false, fetchImpl = fetch } = {}) => {
  if (!key()) throw fail('Flutterwave is not configured', 503);
  let response;
  try {
    response = await fetchImpl(`https://api.flutterwave.com/v3${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000)
    });
  } catch { throw fail('Flutterwave is temporarily unavailable. Please try again.', 503); }
  const payload = await response.json().catch(() => null);
  if (allowNotFound && [200, 400, 404].includes(response.status) && payload?.status !== 'success' &&
      /no transaction|not found|does not exist/i.test(payload?.message || '')) return null;
  if (allowInactiveLink && response.status === 400 && /link is currently inactive/i.test(payload?.message || '')) return true;
  if (!response.ok || payload?.status !== 'success') throw fail('Flutterwave could not process this request. Please try again.', 502);
  return payload.data;
};
