import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Supported country → currency configuration, managed by the admin.
 *
 * One document per country. Drives:
 *  - which currency/symbol a user from that country sees,
 *  - the FX rate used to auto-convert the base USD price when a plan has no
 *    manual override for the country,
 *  - the rounding applied to converted amounts so prices look "clean".
 *
 * USD is the platform base currency (usdRate = 1, isBase = true) and is seeded
 * automatically; manual per-country prices on a Plan always win over conversion.
 */
const currencySchema = new Schema(
  {
    country: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true }, // ISO-3166 alpha-2, e.g. "NG"
    countryName: { type: String, required: true, trim: true },                                          // "Nigeria"
    currency: { type: String, required: true, uppercase: true, trim: true },                            // ISO-4217, e.g. "NGN"
    symbol: { type: String, default: '$' },                                                             // "₦"

    // How many units of `currency` equal 1 USD. Used only for auto-conversion
    // fallback when a plan has no manual price for this country.
    usdRate: { type: Number, default: 1, min: 0 },

    // Round converted amounts to the nearest `roundTo` units (0 = no rounding).
    // e.g. NGN roundTo 50 → ₦5,000 instead of ₦4,987.50
    roundTo: { type: Number, default: 0, min: 0 },

    // Stripe/PayPal cannot take decimals for "zero-decimal" currencies (JPY, KRW…).
    zeroDecimal: { type: Boolean, default: false },

    isBase: { type: Boolean, default: false },   // true only for USD
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const Currency = mongoose.model('Currency', currencySchema);
export default Currency;
