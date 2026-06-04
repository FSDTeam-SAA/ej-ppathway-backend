import countriesStateCity from '../data/countriesStateCity.js';

/**
 * Country (ISO-3166 alpha-2) → default ISO-4217 currency code, covering every
 * country in the bundled dataset (not just the FX-configured ones in the
 * Currency model). Used to decide which currency SYMBOL a user/advisor sees
 * based on the country they selected.
 *
 * NOTE: this is for display only. Actual pricing/charging still resolves through
 * the FX-configured `Currency` catalog (see pricing.service) so payments are
 * never affected by an unconfigured country.
 */
const BY_ISO2 = new Map(
  countriesStateCity.map((c) => [
    String(c.iso2 || '').toUpperCase(),
    String(c.currency || '').toUpperCase()
  ])
);

/** The default ISO-4217 currency code for a country, or '' if unknown. */
export const getCountryCurrencyCode = (iso2) => {
  if (!iso2) return '';
  return BY_ISO2.get(String(iso2).trim().toUpperCase()) || '';
};
