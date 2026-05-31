import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import Currency from '../models/currency.model.js';
import User from '../models/user.model.js';
import { detectCountry } from '../utils/geo.js';
import { getCurrencyForCountry, invalidatePricingCache } from '../services/pricing.service.js';

// ===== Public =====

// List active currencies (e.g. for a country/currency picker in the app/admin).
export const listCurrencies = catchAsync(async (_req, res) => {
  const rows = await Currency.find({ isActive: true })
    .sort({ sortOrder: 1, countryName: 1 })
    .lean();
  return sendResponse(res, { data: rows });
});

// Resolve the currency for the caller's country (auto-detect, persist if logged in).
export const myCurrency = catchAsync(async (req, res) => {
  const country = detectCountry(req, { user: req.user });
  const cur = await getCurrencyForCountry(country);
  if (req.user?._id) {
    await User.updateOne(
      { _id: req.user._id },
      { $set: { country: cur.country, currency: cur.currency } },
      { runValidators: false }
    );
  }
  return sendResponse(res, {
    data: {
      country: cur.country,
      countryName: cur.countryName,
      currency: cur.currency,
      symbol: cur.symbol,
      usdRate: cur.usdRate,
      zeroDecimal: Boolean(cur.zeroDecimal)
    }
  });
});

// ===== Admin CRUD =====

export const adminListCurrencies = catchAsync(async (_req, res) => {
  const rows = await Currency.find().sort({ sortOrder: 1, countryName: 1 }).lean();
  return sendResponse(res, { data: rows });
});

export const createCurrency = catchAsync(async (req, res) => {
  const body = sanitize(req.body);
  if (!body.country || !body.countryName || !body.currency) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'country, countryName and currency are required');
  }
  const existing = await Currency.findOne({ country: body.country });
  if (existing) throw new ApiError(StatusCodes.CONFLICT, `Country ${body.country} already configured`);
  const row = await Currency.create(body);
  invalidatePricingCache();
  return sendResponse(res, { statusCode: StatusCodes.CREATED, data: row });
});

export const updateCurrency = catchAsync(async (req, res) => {
  const body = sanitize(req.body);
  const row = await Currency.findByIdAndUpdate(req.params.id, body, { new: true });
  if (!row) throw new ApiError(StatusCodes.NOT_FOUND, 'Currency not found');
  invalidatePricingCache();
  return sendResponse(res, { data: row });
});

export const deleteCurrency = catchAsync(async (req, res) => {
  const row = await Currency.findById(req.params.id);
  if (!row) throw new ApiError(StatusCodes.NOT_FOUND, 'Currency not found');
  if (row.isBase) throw new ApiError(StatusCodes.BAD_REQUEST, 'Cannot delete the base currency (USD)');
  await row.deleteOne();
  invalidatePricingCache();
  return sendResponse(res, { message: 'Currency removed' });
});

const sanitize = (body = {}) => {
  const out = {};
  if (body.country != null) out.country = String(body.country).trim().toUpperCase();
  if (body.countryName != null) out.countryName = String(body.countryName).trim();
  if (body.currency != null) out.currency = String(body.currency).trim().toUpperCase();
  if (body.symbol != null) out.symbol = String(body.symbol);
  if (body.usdRate != null) out.usdRate = Number(body.usdRate);
  if (body.roundTo != null) out.roundTo = Number(body.roundTo);
  if (body.zeroDecimal != null) out.zeroDecimal = Boolean(body.zeroDecimal);
  if (body.isActive != null) out.isActive = Boolean(body.isActive);
  if (body.sortOrder != null) out.sortOrder = Number(body.sortOrder);
  return out;
};
