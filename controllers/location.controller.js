import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import countriesStateCity from '../data/countriesStateCity.js';

/**
 * In-memory geo catalog (countries → states → cities + ISO currency code) served
 * to populate country / city / currency dropdowns across the website, admin and
 * advisor dashboards. The dataset is static, so everything is derived once at
 * module load and city lists are memoised per country on first request.
 */

// Lightweight country list (no nested states/cities) for the country dropdown.
const COUNTRIES = countriesStateCity
  .map((c) => ({
    id: c.id,
    name: c.name,
    iso2: c.iso2,
    iso3: c.iso3,
    phone_code: c.phone_code,
    capital: c.capital,
    currency: c.currency
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

// iso2 (upper) -> full country record, for resolving states/cities quickly.
const BY_ISO2 = new Map(
  countriesStateCity.map((c) => [String(c.iso2 || '').toUpperCase(), c])
);

// Memoised flattened city lists, keyed by upper-case iso2.
const CITY_CACHE = new Map();

const resolveCountry = (code) => {
  if (!code) return null;
  return BY_ISO2.get(String(code).trim().toUpperCase()) || null;
};

// GET /api/v1/locations/countries
export const listCountries = catchAsync(async (_req, res) => {
  return sendResponse(res, { data: COUNTRIES });
});

// GET /api/v1/locations/countries/:code/states
export const listStates = catchAsync(async (req, res) => {
  const country = resolveCountry(req.params.code);
  if (!country) throw new ApiError(StatusCodes.NOT_FOUND, 'Unknown country');
  const states = (country.states || [])
    .map((s) => ({ id: s.id, name: s.name, state_code: s.state_code }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return sendResponse(res, { data: states });
});

// GET /api/v1/locations/countries/:code/cities
// Flattened, de-duplicated and alphabetised list of every city in the country.
export const listCities = catchAsync(async (req, res) => {
  const country = resolveCountry(req.params.code);
  if (!country) throw new ApiError(StatusCodes.NOT_FOUND, 'Unknown country');

  const key = String(country.iso2 || '').toUpperCase();
  let cities = CITY_CACHE.get(key);
  if (!cities) {
    const seen = new Set();
    cities = [];
    for (const state of country.states || []) {
      for (const city of state.cities || []) {
        if (seen.has(city.name)) continue;
        seen.add(city.name);
        cities.push({ id: city.id, name: city.name, state: state.name });
      }
    }
    cities.sort((a, b) => a.name.localeCompare(b.name));
    CITY_CACHE.set(key, cities);
  }
  return sendResponse(res, { data: cities });
});
