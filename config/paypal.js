/**
 * PayPal REST configuration.
 *
 * We talk to the PayPal Orders v2 REST API directly with fetch (Node 18+ global
 * fetch) so we don't add an SDK dependency — mirroring how the Stripe client is
 * the only payment dependency. Credentials come from env:
 *
 *   PAYPAL_CLIENT_ID
 *   PAYPAL_CLIENT_SECRET
 *   PAYPAL_MODE=sandbox|live   (default: sandbox)
 */

export const PAYPAL_BASE = () =>
  (process.env.PAYPAL_MODE || 'sandbox').toLowerCase() === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

export const isPaypalConfigured = () =>
  Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

let _token = { value: null, expiresAt: 0 };

export const getPaypalAccessToken = async () => {
  if (!isPaypalConfigured()) {
    throw new Error('PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.');
  }
  // reuse cached token until ~60s before expiry
  if (_token.value && Date.now() < _token.expiresAt - 60_000) return _token.value;

  const id = process.env.PAYPAL_CLIENT_ID.trim();
  const secret = process.env.PAYPAL_CLIENT_SECRET.trim();
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');

  const res = await fetch(`${PAYPAL_BASE()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`PayPal auth failed: ${data.error_description || res.status}`);
  }
  _token = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3000) * 1000
  };
  return _token.value;
};

/** Thin wrapper around the PayPal REST API that injects auth + parses JSON. */
export const paypalFetch = async (path, { method = 'GET', body } = {}) => {
  const token = await getPaypalAccessToken();
  const res = await fetch(`${PAYPAL_BASE()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return { ok: res.ok, status: res.status, data };
};
