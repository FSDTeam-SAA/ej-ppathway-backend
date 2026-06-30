import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import Wallet from '../models/wallet.model.js';
import Transaction from '../models/transaction.model.js';
import { getPlatformSettings } from '../models/platformSetting.model.js';
import { creditUsageSummary } from '../services/credit.service.js';

const normalizePacks = (packs = []) => {
  if (!Array.isArray(packs) || packs.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'At least one credit pack is required');
  }

  return packs.map((pack, index) => {
    const credits = Number(pack.credits);
    const bonusCredits = Number(pack.bonusCredits || 0);
    const priceUsd = Number(pack.priceUsd);
    const id = String(pack.id || `credits_${credits}`).trim();
    const label = String(pack.label || `${credits} Credits`).trim();
    if (!id || !label || !Number.isFinite(credits) || credits <= 0 || !Number.isFinite(bonusCredits) || bonusCredits < 0 || !Number.isFinite(priceUsd) || priceUsd < 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Each credit pack needs id, label, credits, non-negative bonusCredits, and non-negative priceUsd');
    }
    return {
      id,
      label,
      credits,
      bonusCredits,
      priceUsd,
      revenueCatProductId: String(pack.revenueCatProductId || id).trim(),
      isActive: pack.isActive !== false,
      sortOrder: Number(pack.sortOrder ?? index + 1)
    };
  });
};

const normalizeUsageBlocks = (blocks = []) => {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'At least one credit usage block is required');
  }

  return blocks.map((block, index) => {
    const durationMinutes = Number(block.durationMinutes || 0);
    const credits = Number(block.credits);
    const id = String(block.id || `${block.sessionType || 'credit'}_${durationMinutes || index + 1}`).trim();
    const activity = String(block.activity || '').trim();
    const sessionType = String(block.sessionType || '').trim();
    if (!id || !activity || !['chat', 'call', 'video', 'add_on'].includes(sessionType)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Each usage block needs id, activity, and a valid sessionType');
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes < 0 || !Number.isFinite(credits) || credits < 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Usage block duration and credits must be non-negative numbers');
    }
    return {
      id,
      activity,
      sessionType,
      durationMinutes,
      credits,
      isActive: block.isActive !== false,
      sortOrder: Number(block.sortOrder ?? index + 1)
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
      creditExpirationDays: settings.creditExpirationDays,
      creditUsdRate: settings.creditUsdRate,
      creditPacks: creditUsage.packs,
      creditUsage: creditUsage.addOns,
      creditUsageBlocks: creditUsage.usageBlocks
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

  if (typeof req.body.creditExpirationDays !== 'undefined') {
    const value = Number(req.body.creditExpirationDays);
    if (!Number.isFinite(value) || value <= 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'creditExpirationDays must be greater than 0');
    }
    settings.creditExpirationDays = value;
  }

  if (typeof req.body.creditPacks !== 'undefined') {
    settings.creditPacks = normalizePacks(req.body.creditPacks);
  }

  if (typeof req.body.creditUsageBlocks !== 'undefined') {
    settings.creditUsageBlocks = normalizeUsageBlocks(req.body.creditUsageBlocks);
    const recording = settings.creditUsageBlocks.find((block) => block.id === 'session_recording');
    const transcript = settings.creditUsageBlocks.find((block) => block.id === 'chat_transcript');
    if (recording) settings.creditUsage.sessionRecording = Number(recording.credits || 0);
    if (transcript) settings.creditUsage.chatTranscript = Number(transcript.credits || 0);
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
      creditExpirationDays: settings.creditExpirationDays,
      creditUsdRate: settings.creditUsdRate,
      creditPacks: creditUsage.packs,
      creditUsage: creditUsage.addOns,
      creditUsageBlocks: creditUsage.usageBlocks
    }
  });
});

// GET /api/v1/admin/credits/summary
export const getCreditManagementSummary = catchAsync(async (_req, res) => {
  const [
    settings,
    walletAgg,
    purchaseAgg,
    usageAgg,
    expiredAgg
  ] = await Promise.all([
    creditUsageSummary(),
    Wallet.aggregate([
      { $group: { _id: null, purchased: { $sum: '$balance' }, free: { $sum: '$freeCredits' }, spent: { $sum: '$totalSpent' } } }
    ]),
    Transaction.aggregate([
      { $match: { status: 'completed', type: 'credit_pack_purchase' } },
      { $group: { _id: null, revenue: { $sum: '$amountUsd' }, count: { $sum: 1 }, credits: { $sum: '$metadata.totalCredits' } } }
    ]),
    Transaction.aggregate([
      { $match: { status: 'completed', type: { $in: ['session_charge', 'unlock_recording', 'unlock_transcript', 'tip'] } } },
      { $group: { _id: '$type', credits: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    Transaction.aggregate([
      { $match: { status: 'completed', type: 'credit_expiration' } },
      { $group: { _id: null, credits: { $sum: '$amount' }, count: { $sum: 1 } } }
    ])
  ]);

  const usageByType = Object.fromEntries(usageAgg.map((item) => [item._id, { credits: item.credits || 0, count: item.count || 0 }]));
  return sendResponse(res, {
    data: {
      settings,
      totals: {
        purchasedBalance: walletAgg[0]?.purchased || 0,
        freeBalance: walletAgg[0]?.free || 0,
        creditsSpent: walletAgg[0]?.spent || 0,
        creditSalesRevenue: purchaseAgg[0]?.revenue || 0,
        creditPurchaseCount: purchaseAgg[0]?.count || 0,
        creditsSold: purchaseAgg[0]?.credits || 0,
        expiredCredits: expiredAgg[0]?.credits || 0,
        expiredCount: expiredAgg[0]?.count || 0
      },
      usageByType
    }
  });
});
