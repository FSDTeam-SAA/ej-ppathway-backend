import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Canonical ISO-4217 currency reference catalog (code → display symbol + name).
 *
 * This is a read-mostly lookup table seeded from `data/currencyCatalog.json`.
 * Unlike the country-keyed `Currency` model (which carries FX rates / rounding
 * for pricing), this one is keyed by the 3-letter currency `code` and is the
 * single source of truth for how a currency's SYMBOL is rendered everywhere a
 * price or balance is shown.
 */
const currencyCatalogSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true }, // ISO-4217, e.g. "AED"
    currencyName: { type: String, required: true, trim: true },                                      // "UAE Dirham"
    primaryCountry: { type: String, trim: true, default: '' },                                       // "United Arab Emirates"
    symbol: { type: String, required: true, trim: true },                                            // "د.إ"
    sourceFile: { type: String, default: '' }
  },
  { timestamps: true }
);

const CurrencyCatalog = mongoose.model('CurrencyCatalog', currencyCatalogSchema);
export default CurrencyCatalog;
