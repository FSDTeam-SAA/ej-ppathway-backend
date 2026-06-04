import { readFileSync } from 'fs';
import CurrencyCatalog from '../models/currencyCatalog.model.js';

/**
 * In-memory cache + helpers for the ISO-4217 currency catalog (code → symbol).
 * Used to render currency symbols consistently across pricing, the currency
 * picker and any balance/amount the API returns.
 */

const CACHE_MS = 5 * 60 * 1000;
let _cache = { at: 0, byCode: new Map() };

// Common fallbacks so symbols still render before/without a DB (kept tiny on
// purpose — the DB catalog is the real source of truth).
const FALLBACK_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', INR: '₹', NGN: '₦' };

const loadCatalog = async () => {
  const now = Date.now();
  if (now - _cache.at < CACHE_MS && _cache.byCode.size) return _cache.byCode;
  const rows = await CurrencyCatalog.find().lean();
  const byCode = new Map();
  for (const r of rows) byCode.set(String(r.code).toUpperCase(), r);
  _cache = { at: now, byCode };
  return byCode;
};

export const invalidateCatalogCache = () => {
  _cache = { at: 0, byCode: new Map() };
};

/** Resolve the display symbol for an ISO-4217 code (falls back to the code itself). */
export const getCurrencySymbol = async (code) => {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return '$';
  const byCode = await loadCatalog();
  return byCode.get(c)?.symbol || FALLBACK_SYMBOLS[c] || c;
};

/** Full catalog entry for a code, or null. */
export const getCurrencyInfo = async (code) => {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  const byCode = await loadCatalog();
  return byCode.get(c) || null;
};

/** The whole catalog as a lightweight, code-sorted array (for dropdowns). */
export const getCurrencyCatalogList = async () => {
  const byCode = await loadCatalog();
  return [...byCode.values()]
    .map((r) => ({
      code: r.code,
      symbol: r.symbol,
      currencyName: r.currencyName,
      primaryCountry: r.primaryCountry || ''
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
};

/**
 * Idempotently import data/currencyCatalog.json into the CurrencyCatalog
 * collection (upsert by code). Tolerates MongoDB extended-JSON ($oid/$date).
 */
export const seedCurrencyCatalog = async () => {
  const url = new URL('../data/currencyCatalog.json', import.meta.url);
  let docs;
  try {
    docs = JSON.parse(readFileSync(url, 'utf-8'));
  } catch (err) {
    console.error('[currencyCatalog] Could not read seed file:', err.message);
    return { inserted: 0, total: 0 };
  }
  if (!Array.isArray(docs)) return { inserted: 0, total: 0 };

  const ops = [];
  for (const d of docs) {
    const code = String(d.code || '').trim().toUpperCase();
    if (!code || !d.symbol) continue;
    ops.push({
      updateOne: {
        filter: { code },
        update: {
          $set: {
            currencyName: d.currencyName || code,
            primaryCountry: d.primaryCountry || '',
            symbol: d.symbol,
            sourceFile: d.sourceFile || ''
          }
        },
        upsert: true
      }
    });
  }
  if (!ops.length) return { inserted: 0, total: 0 };

  const res = await CurrencyCatalog.bulkWrite(ops, { ordered: false });
  invalidateCatalogCache();
  return { inserted: res.upsertedCount || 0, total: ops.length };
};
