import Currency from '../models/currency.model.js';
import { ZERO_DECIMAL_CURRENCIES } from '../utils/geo.js';

/**
 * Multi-currency pricing resolver.
 *
 * Source of truth is each plan's base USD `pricePerMonth`. For a given country we
 * return the amount the user should actually see / be charged, in their local
 * currency, following two rules in priority order:
 *
 *   1. MANUAL override — if the plan has a `countryPrices[]` entry for the country,
 *      that exact amount/currency is used. This is how the admin sets prices based
 *      on local earning power (e.g. a deliberately lower price in Nigeria).
 *   2. FX CONVERT fallback — otherwise convert the base USD price using the
 *      country's stored `usdRate` and round to the currency's `roundTo`.
 *
 * If we have no currency config for the country at all, we fall back to USD.
 */

let _cache = { at: 0, byCountry: new Map() };
const CACHE_MS = 60 * 1000;

const loadCurrencies = async () => {
  const now = Date.now();
  if (now - _cache.at < CACHE_MS && _cache.byCountry.size) return _cache.byCountry;
  const rows = await Currency.find({ isActive: true }).lean();
  const byCountry = new Map();
  for (const r of rows) byCountry.set(r.country, r);
  _cache = { at: now, byCountry };
  return byCountry;
};

export const invalidatePricingCache = () => {
  _cache = { at: 0, byCountry: new Map() };
};

const USD_FALLBACK = {
  country: 'US',
  countryName: 'United States',
  currency: 'USD',
  symbol: '$',
  usdRate: 1,
  roundTo: 0,
  zeroDecimal: false,
  isBase: true
};

export const getCurrencyForCountry = async (country) => {
  const code = (country || 'US').toString().trim().toUpperCase();
  const byCountry = await loadCurrencies();
  return byCountry.get(code) || byCountry.get('US') || USD_FALLBACK;
};

const isZeroDecimal = (cur) =>
  cur?.zeroDecimal === true || ZERO_DECIMAL_CURRENCIES.has((cur?.currency || '').toUpperCase());

const roundAmount = (value, cur) => {
  const step = Number(cur?.roundTo) || 0;
  if (step > 0) return Math.round(value / step) * step;
  if (isZeroDecimal(cur)) return Math.round(value);
  return Math.round(value * 100) / 100;
};

/**
 * Resolve a base USD amount into a country's local currency (FX convert + round).
 * Used for arbitrary amounts such as wallet top-ups.
 */
export const convertUsd = async (amountUsd, country) => {
  const cur = await getCurrencyForCountry(country);
  const base = Number(amountUsd) || 0;
  const converted = cur.isBase ? base : roundAmount(base * (Number(cur.usdRate) || 1), cur);
  return buildPrice({ cur, amount: converted, baseUsd: base, isManual: false });
};

/**
 * Resolve a plan's price for a country.
 * @returns { country, currency, symbol, amount, baseUsd, isManual, zeroDecimal, displayPrice }
 */
export const resolvePlanPrice = async (plan, country) => {
  const cur = await getCurrencyForCountry(country);
  const baseUsd = Number(plan?.pricePerMonth) || 0;

  // 1. Manual override for this exact country.
  const override = (plan?.countryPrices || []).find(
    (cp) => (cp.country || '').toUpperCase() === cur.country && cp.pricePerMonth != null
  );
  if (override) {
    return buildPrice({
      cur,
      amount: Number(override.pricePerMonth) || 0,
      baseUsd,
      isManual: true,
      // an override may declare its own currency (rare); default to the country currency
      currencyOverride: override.currency
    });
  }

  // 2. FX-convert fallback.
  const amount = cur.isBase ? baseUsd : roundAmount(baseUsd * (Number(cur.usdRate) || 1), cur);
  return buildPrice({ cur, amount, baseUsd, isManual: false });
};

const buildPrice = ({ cur, amount, baseUsd, isManual, currencyOverride }) => {
  const currency = (currencyOverride || cur.currency || 'USD').toUpperCase();
  const zeroDecimal = isZeroDecimal({ ...cur, currency });
  return {
    country: cur.country,
    currency,
    symbol: cur.symbol || '$',
    amount,
    baseUsd,
    isManual,
    zeroDecimal,
    displayPrice: formatMoney(amount, cur.symbol || '$', zeroDecimal)
  };
};

export const formatMoney = (amount, symbol = '$', zeroDecimal = false) => {
  const n = Number(amount) || 0;
  const fixed = zeroDecimal || Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2);
  const grouped = fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${symbol}${grouped}`;
};

/**
 * Convert a human amount in a currency to the integer minor units the payment
 * provider expects (cents for normal currencies, whole units for zero-decimal).
 */
export const toProviderMinorUnits = (amount, currency) => {
  const zero = ZERO_DECIMAL_CURRENCIES.has((currency || '').toUpperCase());
  return zero ? Math.round(Number(amount) || 0) : Math.round((Number(amount) || 0) * 100);
};

/**
 * Attach a `localizedPrice` block (and convenience fields) to a plain plan object
 * for API responses.
 */
export const decoratePlanWithPrice = async (plan, country) => {
  const localizedPrice = await resolvePlanPrice(plan, country);
  return { ...plan, localizedPrice };
};
