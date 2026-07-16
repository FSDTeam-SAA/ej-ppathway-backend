import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import Wallet from '../models/wallet.model.js';
import Transaction from '../models/transaction.model.js';
import { DEFAULT_PROMOTION_PLANS, getPlatformSettings } from '../models/platformSetting.model.js';
import { creditUsageSummary } from '../services/credit.service.js';

const bannerPayload = (settings) => ({
  creditBannerTitle: settings.creditBannerTitle || 'Prophetic Guidance',
  creditBannerSubtitle: settings.creditBannerSubtitle || 'As low as $1 per credit'
});

const promotionPlanEntries = (promotionPlans) => {
  if (promotionPlans instanceof Map) return Array.from(promotionPlans.entries());
  return Object.entries(promotionPlans || {});
};

const serializePromotionPlans = (promotionPlans) =>
  promotionPlanEntries(promotionPlans)
    .map(([id, plan], index) => ({
      id,
      label: plan.label || DEFAULT_PROMOTION_PLANS[id]?.label || id,
      price: Number(plan.price || 0),
      days: Number(plan.days || 1),
      visibilityBoost: Number(plan.visibilityBoost || DEFAULT_PROMOTION_PLANS[id]?.visibilityBoost || 1),
      impressionsPerDay: Number(plan.impressionsPerDay || 0),
      features: Array.isArray(plan.features) ? plan.features : [],
      tone: plan.tone || DEFAULT_PROMOTION_PLANS[id]?.tone || 'emerald',
      isActive: plan.isActive !== false,
      isPopular: plan.isPopular === true,
      sortOrder: Number(plan.sortOrder ?? DEFAULT_PROMOTION_PLANS[id]?.sortOrder ?? index + 1)
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));

const normalizePromotionPlan = (body = {}, id, index = 0, existing = {}) => {
  const cleanId = String(id || body.id || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(cleanId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Plan ID may contain lowercase letters, numbers, underscores, and hyphens only');
  }

  const label = String(body.label ?? existing.label ?? '').trim();
  const price = Number(body.price ?? existing.price);
  const days = Number(body.days ?? existing.days);
  const visibilityBoost = Number(body.visibilityBoost ?? existing.visibilityBoost ?? 1);
  const impressionsPerDay = Number(body.impressionsPerDay ?? existing.impressionsPerDay ?? 0);
  const sortOrder = Number(body.sortOrder ?? existing.sortOrder ?? index + 1);
  const features = Array.isArray(body.features ?? existing.features)
    ? (body.features ?? existing.features).map((item) => String(item || '').trim()).filter(Boolean)
    : String(body.features || '')
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  const tone = ['emerald', 'violet', 'amber', 'sky', 'slate'].includes(body.tone ?? existing.tone)
    ? body.tone ?? existing.tone
    : 'emerald';

  if (!label || !Number.isFinite(price) || price < 0 || !Number.isFinite(days) || days <= 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Each promotion plan needs a label, non-negative price, and positive days');
  }
  if (!Number.isFinite(visibilityBoost) || visibilityBoost < 0 || !Number.isFinite(impressionsPerDay) || impressionsPerDay < 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Visibility boost and impressions must be non-negative numbers');
  }

  return {
    label,
    price,
    days,
    visibilityBoost,
    impressionsPerDay,
    features,
    tone,
    isActive: body.isActive ?? existing.isActive ?? true,
    isPopular: body.isPopular ?? existing.isPopular ?? false,
    sortOrder
  };
};

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

// GET /api/v1/admin/promotion-plans
export const listPromotionPlans = catchAsync(async (_req, res) => {
  const settings = await getPlatformSettings();
  return sendResponse(res, { data: serializePromotionPlans(settings.promotionPlans) });
});

// POST /api/v1/admin/promotion-plans
export const createPromotionPlan = catchAsync(async (req, res) => {
  const settings = await getPlatformSettings();
  const id = String(req.body.id || '').trim().toLowerCase();
  if (settings.promotionPlans.get(id)) {
    throw new ApiError(StatusCodes.CONFLICT, 'A promotion plan with this ID already exists');
  }
  const plan = normalizePromotionPlan(req.body, id, settings.promotionPlans.size);
  settings.promotionPlans.set(id, plan);
  await settings.save();
  return sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Promotion plan created',
    data: { id, ...plan }
  });
});

// PATCH /api/v1/admin/promotion-plans/:id
export const updatePromotionPlan = catchAsync(async (req, res) => {
  const settings = await getPlatformSettings();
  const id = String(req.params.id || '').trim().toLowerCase();
  const existing = settings.promotionPlans.get(id);
  if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, 'Promotion plan not found');

  const plan = normalizePromotionPlan(req.body, id, 0, existing);
  settings.promotionPlans.set(id, plan);
  await settings.save();
  return sendResponse(res, { message: 'Promotion plan updated', data: { id, ...plan } });
});

// DELETE /api/v1/admin/promotion-plans/:id
export const deletePromotionPlan = catchAsync(async (req, res) => {
  const settings = await getPlatformSettings();
  const id = String(req.params.id || '').trim().toLowerCase();
  if (!settings.promotionPlans.get(id)) throw new ApiError(StatusCodes.NOT_FOUND, 'Promotion plan not found');
  settings.promotionPlans.delete(id);
  await settings.save();
  return sendResponse(res, { message: 'Promotion plan deleted', data: { id } });
});

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
      ...bannerPayload(settings),
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

  if (typeof req.body.creditBannerTitle !== 'undefined') {
    const value = String(req.body.creditBannerTitle || '').trim();
    if (!value) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'creditBannerTitle is required');
    }
    settings.creditBannerTitle = value;
  }

  if (typeof req.body.creditBannerSubtitle !== 'undefined') {
    const value = String(req.body.creditBannerSubtitle || '').trim();
    if (!value) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'creditBannerSubtitle is required');
    }
    settings.creditBannerSubtitle = value;
  }

  if (typeof req.body.creditPacks !== 'undefined') {
    settings.creditPacks = normalizePacks(req.body.creditPacks);
  }

  if (typeof req.body.creditUsageBlocks !== 'undefined') {
    settings.creditUsageBlocks = normalizeUsageBlocks(req.body.creditUsageBlocks);
    const recording = settings.creditUsageBlocks.find((block) => block.id === 'session_recording');
    const videoRecording = settings.creditUsageBlocks.find((block) => block.id === 'video_recording');
    const audioRecording = settings.creditUsageBlocks.find((block) => block.id === 'audio_recording');
    const transcript = settings.creditUsageBlocks.find((block) => block.id === 'chat_transcript');
    if (recording) settings.creditUsage.sessionRecording = Number(recording.credits || 0);
    if (videoRecording) settings.creditUsage.videoRecording = Number(videoRecording.credits || 0);
    if (audioRecording) settings.creditUsage.audioRecording = Number(audioRecording.credits || 0);
    if (!recording && (videoRecording || audioRecording)) {
      settings.creditUsage.sessionRecording = Math.max(
        Number(videoRecording?.credits || 0),
        Number(audioRecording?.credits || 0)
      );
    }
    if (transcript) settings.creditUsage.chatTranscript = Number(transcript.credits || 0);
  }

  if (req.body.creditUsage && typeof req.body.creditUsage === 'object') {
    const transcript = Number(req.body.creditUsage.chatTranscript);
    const legacyRecording = Number(req.body.creditUsage.sessionRecording);
    const videoRecording = Number(req.body.creditUsage.videoRecording ?? legacyRecording);
    const audioRecording = Number(req.body.creditUsage.audioRecording ?? legacyRecording);
    if (
      !Number.isFinite(transcript) ||
      transcript < 0 ||
      !Number.isFinite(videoRecording) ||
      videoRecording < 0 ||
      !Number.isFinite(audioRecording) ||
      audioRecording < 0
    ) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Credit usage values must be non-negative numbers');
    }
    settings.creditUsage.chatTranscript = transcript;
    settings.creditUsage.videoRecording = videoRecording;
    settings.creditUsage.audioRecording = audioRecording;
    settings.creditUsage.sessionRecording = Number.isFinite(legacyRecording) && legacyRecording >= 0
      ? legacyRecording
      : Math.max(videoRecording, audioRecording);
  }

  await settings.save();
  const creditUsage = await creditUsageSummary();
  return sendResponse(res, {
    message: 'Credit settings updated',
    data: {
      signupFreeCredits: settings.signupFreeCredits,
      creditExpirationDays: settings.creditExpirationDays,
      creditUsdRate: settings.creditUsdRate,
      ...bannerPayload(settings),
      creditPacks: creditUsage.packs,
      creditUsage: creditUsage.addOns,
      creditUsageBlocks: creditUsage.usageBlocks
    }
  });
});

// GET /api/v1/wallet/credit-banner
export const getPublicCreditBanner = catchAsync(async (_req, res) => {
  const settings = await getPlatformSettings();
  return sendResponse(res, { data: bannerPayload(settings) });
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
