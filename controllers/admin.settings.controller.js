import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { getPlatformSettings } from '../models/platformSetting.model.js';
import { creditUsageSummary } from '../services/credit.service.js';

const normalizePacks = (packs = []) => {
  if (!Array.isArray(packs) || packs.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'At least one credit pack is required');
  }

  return packs.map((pack, index) => {
    const credits = Number(pack.credits);
    const priceUsd = Number(pack.priceUsd);
    const id = String(pack.id || `credits_${credits}`).trim();
    const label = String(pack.label || `${credits} Credits`).trim();
    if (!id || !label || !Number.isFinite(credits) || credits <= 0 || !Number.isFinite(priceUsd) || priceUsd < 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Each credit pack needs id, label, credits, and non-negative priceUsd');
    }
    return {
      id,
      label,
      credits,
      priceUsd,
      revenueCatProductId: String(pack.revenueCatProductId || id).trim(),
      isActive: pack.isActive !== false,
      sortOrder: Number(pack.sortOrder ?? index + 1)
    };
  });
};

// GET /api/v1/admin/settings/signup-credits
export const getSignupFreeCredits = catchAsync(async (_req, res) => {
  const settings = await getPlatformSettings();
  return sendResponse(res, { data: { signupFreeCredits: settings.signupFreeCredits } });
});

// PATCH /api/v1/admin/settings/signup-credits
export const updateSignupFreeCredits = catchAsync(async (req, res) => {
  const { signupFreeCredits } = req.body;
  const value = Number(signupFreeCredits);
  if (!Number.isFinite(value) || value < 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'signupFreeCredits must be a non-negative number');
  }
  const settings = await getPlatformSettings();
  settings.signupFreeCredits = value;
  await settings.save();
  return sendResponse(res, { message: 'Signup free credits updated', data: { signupFreeCredits: settings.signupFreeCredits } });
});

// GET /api/v1/admin/settings/credits
export const getCreditSettings = catchAsync(async (_req, res) => {
  const settings = await getPlatformSettings();
  const creditUsage = await creditUsageSummary();
  return sendResponse(res, {
    data: {
      signupFreeCredits: settings.signupFreeCredits,
      creditUsdRate: settings.creditUsdRate,
      creditPacks: creditUsage.packs,
      creditUsage: creditUsage.addOns
    }
  });
});

// PATCH /api/v1/admin/settings/credits
export const updateCreditSettings = catchAsync(async (req, res) => {
  const settings = await getPlatformSettings();

  if (typeof req.body.signupFreeCredits !== 'undefined') {
    const value = Number(req.body.signupFreeCredits);
    if (!Number.isFinite(value) || value < 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'signupFreeCredits must be a non-negative number');
    }
    settings.signupFreeCredits = value;
  }

  if (typeof req.body.creditUsdRate !== 'undefined') {
    const value = Number(req.body.creditUsdRate);
    if (!Number.isFinite(value) || value <= 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'creditUsdRate must be greater than 0');
    }
    settings.creditUsdRate = value;
  }

  if (typeof req.body.creditPacks !== 'undefined') {
    settings.creditPacks = normalizePacks(req.body.creditPacks);
  }

  if (req.body.creditUsage && typeof req.body.creditUsage === 'object') {
    const transcript = Number(req.body.creditUsage.chatTranscript);
    const recording = Number(req.body.creditUsage.sessionRecording);
    if (!Number.isFinite(transcript) || transcript < 0 || !Number.isFinite(recording) || recording < 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Credit usage values must be non-negative numbers');
    }
    settings.creditUsage.chatTranscript = transcript;
    settings.creditUsage.sessionRecording = recording;
  }

  await settings.save();
  const creditUsage = await creditUsageSummary();
  return sendResponse(res, {
    message: 'Credit settings updated',
    data: {
      signupFreeCredits: settings.signupFreeCredits,
      creditUsdRate: settings.creditUsdRate,
      creditPacks: creditUsage.packs,
      creditUsage: creditUsage.addOns
    }
  });
});
