/**
 * Hyperwallet REST configuration.
 *
 * Hyperwallet (a PayPal company) is used to send real payouts to advisors — the
 * missing "money actually moves" step behind the admin Payouts queue. As with the
 * Stripe and PayPal clients we talk to the REST API directly with the global
 * `fetch` (Node 18+) instead of adding an SDK dependency.
 *
 * Auth is HTTP Basic using the API credentials issued for a Hyperwallet program.
 * Credentials come from env:
 *
 *   HYPERWALLET_USERNAME        REST API username (from the program portal)
 *   HYPERWALLET_PASSWORD        REST API password
 *   HYPERWALLET_PROGRAM_TOKEN   prg-xxxxxxxx (program the users/payments belong to)
 *   HYPERWALLET_MODE            sandbox | production   (default: sandbox)
 *
 * All REST resources live under the /rest/v4 prefix.
 */

export const HYPERWALLET_BASE = () =>
  (process.env.HYPERWALLET_MODE || 'sandbox').toLowerCase() === 'production'
    ? 'https://api.paylution.com'
    : 'https://api.sandbox.hyperwallet.com';

const API_PREFIX = '/rest/v4';

export const isHyperwalletConfigured = () =>
  Boolean(
    process.env.HYPERWALLET_USERNAME &&
      process.env.HYPERWALLET_PASSWORD &&
      process.env.HYPERWALLET_PROGRAM_TOKEN
  );

export const getHyperwalletProgramToken = () =>
  (process.env.HYPERWALLET_PROGRAM_TOKEN || '').trim();

const basicAuthHeader = () => {
  const user = (process.env.HYPERWALLET_USERNAME || '').trim();
  const pass = (process.env.HYPERWALLET_PASSWORD || '').trim();
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
};

/**
 * Thin wrapper around the Hyperwallet REST API that injects Basic auth + JSON
 * headers and normalises the response.
 *
 * Hyperwallet returns validation problems as `{ errors: [{ code, message, fieldName }] }`
 * with a non-2xx status, so callers get `{ ok, status, data }` and can surface
 * `data.errors[0].message`.
 *
 * @param {string} path   e.g. '/users' or '/payments' (the /rest/v4 prefix is added)
 * @param {{ method?: string, body?: any }} [opts]
 */
export const hyperwalletFetch = async (path, { method = 'GET', body } = {}) => {
  if (!isHyperwalletConfigured()) {
    throw new Error(
      'Hyperwallet is not configured. Set HYPERWALLET_USERNAME, HYPERWALLET_PASSWORD and HYPERWALLET_PROGRAM_TOKEN.'
    );
  }

  const res = await fetch(`${HYPERWALLET_BASE()}${API_PREFIX}${path}`, {
    method,
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
};

/** Extract a human-readable message from a Hyperwallet error payload. */
export const hyperwalletErrorMessage = (data, fallback = 'Hyperwallet request failed') => {
  const err = data?.errors?.[0];
  if (!err) return data?.message || fallback;
  return [err.message, err.fieldName ? `(${err.fieldName})` : '', err.code ? `[${err.code}]` : '']
    .filter(Boolean)
    .join(' ');
};
