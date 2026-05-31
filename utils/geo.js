/**
 * Country detection + the default currency catalog.
 *
 * Country resolution order (first match wins):
 *   1. explicit `country` in the request body / query (app override or admin tooling)
 *   2. the authenticated user's saved country
 *   3. CDN / proxy geo headers (Cloudflare, Vercel, common LB headers)
 *   4. DEFAULT_COUNTRY env (falls back to "US")
 *
 * The mobile app should send `X-Country` (or pass `country` in the body) once it
 * knows the device locale; we persist it to the user so the next request is stable.
 */

const GEO_HEADERS = [
  'cf-ipcountry',          // Cloudflare
  'x-vercel-ip-country',   // Vercel
  'x-country',             // explicit app header
  'x-app-country',
  'x-geo-country'
];

export const detectCountry = (req, { user } = {}) => {
  const fromBody = (req?.body?.country || req?.query?.country || '').toString().trim().toUpperCase();
  if (fromBody && fromBody.length === 2) return fromBody;

  const savedRaw = user?.country || req?.user?.country;
  const saved = (savedRaw || '').toString().trim().toUpperCase();
  if (saved && saved.length === 2) return saved;

  for (const h of GEO_HEADERS) {
    const v = (req?.get?.(h) || req?.headers?.[h] || '').toString().trim().toUpperCase();
    if (v && v.length === 2 && v !== 'XX') return v;
  }

  return (process.env.DEFAULT_COUNTRY || 'US').toUpperCase();
};

/**
 * Default catalog seeded on first boot. Admin can edit rates/rounding or add
 * countries via /admin/currencies. Rates are approximate launch defaults and are
 * only used for the auto-convert fallback — manual per-country plan prices win.
 */
export const DEFAULT_CURRENCIES = [
  { country: 'US', countryName: 'United States', currency: 'USD', symbol: '$', usdRate: 1, roundTo: 0, isBase: true, sortOrder: 0 },
  { country: 'GB', countryName: 'United Kingdom', currency: 'GBP', symbol: '£', usdRate: 0.79, roundTo: 0, sortOrder: 1 },
  { country: 'CA', countryName: 'Canada', currency: 'CAD', symbol: 'CA$', usdRate: 1.37, roundTo: 0, sortOrder: 2 },
  { country: 'AU', countryName: 'Australia', currency: 'AUD', symbol: 'A$', usdRate: 1.52, roundTo: 0, sortOrder: 3 },
  { country: 'NG', countryName: 'Nigeria', currency: 'NGN', symbol: '₦', usdRate: 1550, roundTo: 50, sortOrder: 4 },
  { country: 'IN', countryName: 'India', currency: 'INR', symbol: '₹', usdRate: 83, roundTo: 5, sortOrder: 5 },
  { country: 'KE', countryName: 'Kenya', currency: 'KES', symbol: 'KSh', usdRate: 129, roundTo: 5, sortOrder: 6 },
  { country: 'ZA', countryName: 'South Africa', currency: 'ZAR', symbol: 'R', usdRate: 18.5, roundTo: 1, sortOrder: 7 },
  { country: 'GH', countryName: 'Ghana', currency: 'GHS', symbol: 'GH₵', usdRate: 15, roundTo: 1, sortOrder: 8 },
  { country: 'PH', countryName: 'Philippines', currency: 'PHP', symbol: '₱', usdRate: 58, roundTo: 1, sortOrder: 9 },
  { country: 'EU', countryName: 'Eurozone', currency: 'EUR', symbol: '€', usdRate: 0.92, roundTo: 0, sortOrder: 10 },
  { country: 'JP', countryName: 'Japan', currency: 'JPY', symbol: '¥', usdRate: 157, roundTo: 10, zeroDecimal: true, sortOrder: 11 }
];

// Currencies Stripe/PayPal treat as zero-decimal (amount sent as whole units, not cents).
export const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF',
  'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'
]);
