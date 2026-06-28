import {
  DEFAULT_ADVISOR_CREDIT_PRICING,
  DEFAULT_CREDIT_PACKS,
  DEFAULT_CREDIT_USAGE,
  DEFAULT_CREDIT_USD_RATE,
  getPlatformSettings
} from '../models/platformSetting.model.js';

export const CREDIT_PACKS = DEFAULT_CREDIT_PACKS;
export const CREDIT_USAGE = DEFAULT_CREDIT_USAGE;
export const DEFAULT_CREDIT_PRICING = DEFAULT_ADVISOR_CREDIT_PRICING;

const roundCredits = (value) => Math.ceil(Number(value || 0));
const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const normalizePack = (pack, index = 0) => ({
  id: String(pack.id || `credits_${pack.credits || index + 1}`).trim(),
  label: String(pack.label || `${pack.credits || 0} Credits`).trim(),
  credits: Number(pack.credits || 0),
  priceUsd: Number(pack.priceUsd || 0),
  revenueCatProductId: String(pack.revenueCatProductId || pack.id || '').trim(),
  isActive: pack.isActive !== false,
  sortOrder: Number(pack.sortOrder ?? index + 1)
});

export const listCreditPacks = async ({ includeInactive = false } = {}) => {
  const settings = await getPlatformSettings();
  return (settings.creditPacks || DEFAULT_CREDIT_PACKS)
    .map(normalizePack)
    .filter((pack) => includeInactive || pack.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.credits - b.credits);
};

export const getCreditUsage = async () => {
  const settings = await getPlatformSettings();
  return {
    chatTranscript: Number(settings.creditUsage?.chatTranscript ?? DEFAULT_CREDIT_USAGE.chatTranscript),
    sessionRecording: Number(settings.creditUsage?.sessionRecording ?? DEFAULT_CREDIT_USAGE.sessionRecording)
  };
};

export const getCreditUsdRate = async () => {
  const settings = await getPlatformSettings();
  const rate = Number(settings.creditUsdRate ?? DEFAULT_CREDIT_USD_RATE);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_CREDIT_USD_RATE;
};

export const findCreditPack = async ({ packId, credits }) => {
  const packs = await listCreditPacks();
  if (packId) {
    return packs.find((pack) => pack.id === packId || pack.revenueCatProductId === packId);
  }

  const requestedCredits = Number(credits);
  const existingPack = packs.find((pack) => pack.credits === requestedCredits);
  if (existingPack) return existingPack;

  if (!Number.isFinite(requestedCredits) || requestedCredits <= 0) return null;
  const normalizedCredits = Math.ceil(requestedCredits);
  const creditUsdRate = await getCreditUsdRate();
  return {
    id: `custom_${normalizedCredits}`,
    label: `${normalizedCredits} Custom Credits`,
    credits: normalizedCredits,
    priceUsd: roundMoney(normalizedCredits * creditUsdRate),
    revenueCatProductId: '',
    isActive: true,
    sortOrder: 9999,
    isCustom: true,
    creditUsdRate
  };
};

export const findCreditPackByRevenueCatProduct = async (productId) => {
  const id = String(productId || '').trim();
  if (!id) return null;
  const packs = await listCreditPacks();
  return packs.find((pack) => pack.revenueCatProductId === id || pack.id === id) || null;
};

export const getAdvisorCreditRate = (profile, type) => {
  const pricing = profile?.pricing || {};
  if (type === 'chat') return Number(pricing.chatPerMin ?? DEFAULT_CREDIT_PRICING.chatPerMin);
  if (type === 'call') return Number(pricing.callPerMin ?? DEFAULT_CREDIT_PRICING.callPerMin);
  if (type === 'video') return Number(pricing.videoPerMin ?? DEFAULT_CREDIT_PRICING.videoPerMin);
  return 1;
};

export const calculateSessionCredits = ({ profile, type, durationMinutes }) => {
  const duration = Math.max(1, Number(durationMinutes) || 15);
  const ratePerMin = Math.max(0, getAdvisorCreditRate(profile, type));
  return {
    ratePerMin,
    credits: roundCredits(ratePerMin * duration)
  };
};

export const creditUsageSummary = async () => ({
  packs: await listCreditPacks(),
  creditUsdRate: await getCreditUsdRate(),
  customPurchasesEnabled: true,
  addOns: await getCreditUsage()
});
