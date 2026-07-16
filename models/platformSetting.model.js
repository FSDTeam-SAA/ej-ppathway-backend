import mongoose from 'mongoose';

const { Schema } = mongoose;

const creditPackSchema = new Schema(
  {
    id: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    credits: { type: Number, required: true, min: 1 },
    bonusCredits: { type: Number, default: 0, min: 0 },
    priceUsd: { type: Number, required: true, min: 0 },
    revenueCatProductId: { type: String, default: '', trim: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 }
  },
  { _id: false }
);

const DEFAULT_CREDIT_PACKS = [
  { id: 'credits_25', label: '25 Credits', credits: 25, bonusCredits: 0, priceUsd: 19, revenueCatProductId: 'credits_25', isActive: true, sortOrder: 1 },
  { id: 'credits_50', label: '50 Credits', credits: 50, bonusCredits: 0, priceUsd: 35, revenueCatProductId: 'credits_50', isActive: true, sortOrder: 2 },
  { id: 'credits_100', label: '100 Credits', credits: 100, bonusCredits: 0, priceUsd: 59, revenueCatProductId: 'credits_100', isActive: true, sortOrder: 3 },
  { id: 'credits_200', label: '200 Credits', credits: 200, bonusCredits: 0, priceUsd: 99, revenueCatProductId: 'credits_200', isActive: true, sortOrder: 4 }
];

const DEFAULT_CREDIT_USAGE = {
  chatTranscript: 5,
  videoRecording: 5,
  audioRecording: 5,
  sessionRecording: 5
};

const DEFAULT_CREDIT_USAGE_BLOCKS = [
  { id: 'chat_15', activity: '15-Minute Chat Session', sessionType: 'chat', durationMinutes: 15, credits: 5, isActive: true, sortOrder: 1 },
  { id: 'voice_5', activity: '5-Minute Voice Call', sessionType: 'call', durationMinutes: 5, credits: 8, isActive: true, sortOrder: 2 },
  { id: 'voice_10', activity: '10-Minute Voice Call', sessionType: 'call', durationMinutes: 10, credits: 10, isActive: true, sortOrder: 3 },
  { id: 'voice_15', activity: '15-Minute Voice Call', sessionType: 'call', durationMinutes: 15, credits: 15, isActive: true, sortOrder: 4 },
  { id: 'video_5', activity: '5-Minute Video Call', sessionType: 'video', durationMinutes: 5, credits: 10, isActive: true, sortOrder: 5 },
  { id: 'video_10', activity: '10-Minute Video Call', sessionType: 'video', durationMinutes: 10, credits: 15, isActive: true, sortOrder: 6 },
  { id: 'video_15', activity: '15-Minute Video Call', sessionType: 'video', durationMinutes: 15, credits: 20, isActive: true, sortOrder: 7 },
  { id: 'video_recording', activity: 'Video Recording Unlock', sessionType: 'add_on', durationMinutes: 0, credits: 5, isActive: true, sortOrder: 8 },
  { id: 'audio_recording', activity: 'Audio Recording Unlock', sessionType: 'add_on', durationMinutes: 0, credits: 5, isActive: true, sortOrder: 9 },
  { id: 'chat_transcript', activity: 'Chat PDF Transcript Unlock', sessionType: 'add_on', durationMinutes: 0, credits: 5, isActive: true, sortOrder: 10 }
];

const DEFAULT_CREDIT_EXPIRATION_DAYS = 60;
const DEFAULT_CREDIT_USD_RATE = 1;
const DEFAULT_CREDIT_BANNER_TITLE = 'Prophetic Guidance';
const DEFAULT_CREDIT_BANNER_SUBTITLE = 'As low as $1 per credit';

const DEFAULT_ADVISOR_CREDIT_PRICING = {
  chatPerMin: 0,
  callPerMin: 0,
  videoPerMin: 0
};

const DEFAULT_PROMOTION_PLANS = {
  basic: {
    label: 'Basic Boost',
    price: 29,
    days: 7,
    visibilityBoost: 2,
    impressionsPerDay: 100,
    features: ['2x profile visibility', '100 impressions/day', 'Standard placement'],
    tone: 'emerald',
    isActive: true,
    isPopular: false,
    sortOrder: 1
  },
  pro: {
    label: 'Pro Featured',
    price: 79,
    days: 14,
    visibilityBoost: 5,
    impressionsPerDay: 500,
    features: ['5x profile visibility', '500 impressions/day', 'Featured in category', 'Top of search results'],
    tone: 'violet',
    isActive: true,
    isPopular: true,
    sortOrder: 2
  },
  premium: {
    label: 'Premium Spotlight',
    price: 149,
    days: 30,
    visibilityBoost: 10,
    impressionsPerDay: 0,
    features: ['10x profile visibility', 'Unlimited impressions', 'Homepage featured', 'Top search placement', 'Social media promotion'],
    tone: 'amber',
    isActive: true,
    isPopular: false,
    sortOrder: 3
  }
};

const promotionPlanSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    days: { type: Number, required: true, min: 1 },
    visibilityBoost: { type: Number, default: 1, min: 0 },
    impressionsPerDay: { type: Number, default: 0, min: 0 },
    features: { type: [String], default: [] },
    tone: { type: String, enum: ['emerald', 'violet', 'amber', 'sky', 'slate'], default: 'emerald' },
    isActive: { type: Boolean, default: true },
    isPopular: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 }
  },
  { _id: false }
);

// Singleton-like document holding global commission/tier rates and other platform settings.
const platformSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    commissions: {
      silver: { type: Number, default: 20, min: 0, max: 100 },
      gold: { type: Number, default: 15, min: 0, max: 100 },
      platinum: { type: Number, default: 10, min: 0, max: 100 }
    },
    tierThresholds: {
      silver: { sessions: { type: Number, default: 50 }, ratings: { type: Number, default: 4 }, retention: { type: Number, default: 70 } },
      gold: { sessions: { type: Number, default: 150 }, ratings: { type: Number, default: 4.5 }, retention: { type: Number, default: 80 } },
      platinum: { sessions: { type: Number, default: 300 }, ratings: { type: Number, default: 4.8 }, retention: { type: Number, default: 85 } }
    },
    promotionPlans: { type: Map, of: promotionPlanSchema, default: () => DEFAULT_PROMOTION_PLANS },
    minWithdrawal: { type: Number, default: 50 },
    // Payout configuration (Hyperwallet). Advisor earnings are held in credits;
    // payoutCreditUsdRate converts credits → real USD when money is sent out. It
    // is intentionally separate from `creditUsdRate` (the sell rate) so the
    // platform margin on payouts is controllable.
    payout: {
      provider: { type: String, enum: ['hyperwallet', 'manual'], default: 'hyperwallet' },
      hyperwalletEnabled: { type: Boolean, default: false },
      payoutCreditUsdRate: { type: Number, default: DEFAULT_CREDIT_USD_RATE, min: 0 },
      payoutCurrency: { type: String, default: 'USD', uppercase: true, trim: true },
      minPayoutCredits: { type: Number, default: 50, min: 0 }
    },
    sessionLowBalanceThresholdMin: { type: Number, default: 2 },
    signupFreeCredits: { type: Number, default: 0, min: 0 },
    creditExpirationDays: { type: Number, default: DEFAULT_CREDIT_EXPIRATION_DAYS, min: 1 },
    creditUsdRate: { type: Number, default: DEFAULT_CREDIT_USD_RATE, min: 0 },
    creditBannerTitle: { type: String, default: DEFAULT_CREDIT_BANNER_TITLE, trim: true },
    creditBannerSubtitle: { type: String, default: DEFAULT_CREDIT_BANNER_SUBTITLE, trim: true },
    creditPacks: { type: [creditPackSchema], default: () => DEFAULT_CREDIT_PACKS },
    creditUsage: {
      chatTranscript: { type: Number, default: DEFAULT_CREDIT_USAGE.chatTranscript, min: 0 },
      videoRecording: { type: Number, default: DEFAULT_CREDIT_USAGE.videoRecording, min: 0 },
      audioRecording: { type: Number, default: DEFAULT_CREDIT_USAGE.audioRecording, min: 0 },
      sessionRecording: { type: Number, default: DEFAULT_CREDIT_USAGE.sessionRecording, min: 0 }
    },
    creditUsageBlocks: { type: [new Schema({
      id: { type: String, required: true, trim: true },
      activity: { type: String, required: true, trim: true },
      sessionType: { type: String, enum: ['chat', 'call', 'video', 'add_on'], required: true },
      durationMinutes: { type: Number, default: 0, min: 0 },
      credits: { type: Number, required: true, min: 0 },
      isActive: { type: Boolean, default: true },
      sortOrder: { type: Number, default: 0 }
    }, { _id: false })], default: () => DEFAULT_CREDIT_USAGE_BLOCKS }
  },
  { timestamps: true }
);

const PlatformSetting = mongoose.model('PlatformSetting', platformSettingSchema);

export const getPlatformSettings = async () => {
  let s = await PlatformSetting.findOne({ key: 'global' });
  if (!s) s = await PlatformSetting.create({ key: 'global' });
  if (typeof s.commissions?.silver !== 'number') s.commissions.silver = 20;
  if (typeof s.commissions?.gold !== 'number') s.commissions.gold = 15;
  if (typeof s.commissions?.platinum !== 'number') s.commissions.platinum = 10;
  if (!s.tierThresholds?.silver) s.tierThresholds.silver = { sessions: 50, ratings: 4, retention: 70 };
  if (!s.tierThresholds?.gold) s.tierThresholds.gold = { sessions: 150, ratings: 4.5, retention: 80 };
  if (!s.tierThresholds?.platinum) s.tierThresholds.platinum = { sessions: 300, ratings: 4.8, retention: 85 };
  if (!s.promotionPlans || (s.promotionPlans instanceof Map && s.promotionPlans.size === 0)) {
    s.promotionPlans = DEFAULT_PROMOTION_PLANS;
  }
  if (!(s.promotionPlans instanceof Map)) {
    s.promotionPlans = new Map(Object.entries(s.promotionPlans || DEFAULT_PROMOTION_PLANS));
  }
  if (typeof s.creditUsdRate !== 'number') s.creditUsdRate = DEFAULT_CREDIT_USD_RATE;
  if (!s.creditBannerTitle) s.creditBannerTitle = DEFAULT_CREDIT_BANNER_TITLE;
  if (!s.creditBannerSubtitle) s.creditBannerSubtitle = DEFAULT_CREDIT_BANNER_SUBTITLE;
  if (typeof s.creditExpirationDays !== 'number') s.creditExpirationDays = DEFAULT_CREDIT_EXPIRATION_DAYS;
  if (!Array.isArray(s.creditPacks) || s.creditPacks.length === 0) s.creditPacks = DEFAULT_CREDIT_PACKS;
  if (!s.creditUsage) s.creditUsage = DEFAULT_CREDIT_USAGE;
  if (typeof s.creditUsage.chatTranscript !== 'number') s.creditUsage.chatTranscript = DEFAULT_CREDIT_USAGE.chatTranscript;
  if (typeof s.creditUsage.videoRecording !== 'number') s.creditUsage.videoRecording = s.creditUsage.sessionRecording ?? DEFAULT_CREDIT_USAGE.videoRecording;
  if (typeof s.creditUsage.audioRecording !== 'number') s.creditUsage.audioRecording = s.creditUsage.sessionRecording ?? DEFAULT_CREDIT_USAGE.audioRecording;
  if (typeof s.creditUsage.sessionRecording !== 'number') s.creditUsage.sessionRecording = DEFAULT_CREDIT_USAGE.sessionRecording;
  if (!Array.isArray(s.creditUsageBlocks) || s.creditUsageBlocks.length === 0) {
    s.creditUsageBlocks = DEFAULT_CREDIT_USAGE_BLOCKS;
  } else {
    const existingBlockIds = new Set(s.creditUsageBlocks.map((block) => block.id));
    for (const block of DEFAULT_CREDIT_USAGE_BLOCKS) {
      if (!existingBlockIds.has(block.id)) s.creditUsageBlocks.push(block);
    }
  }
  if (!s.payout) s.payout = {};
  if (typeof s.payout.payoutCreditUsdRate !== 'number') s.payout.payoutCreditUsdRate = s.creditUsdRate ?? DEFAULT_CREDIT_USD_RATE;
  if (!s.payout.payoutCurrency) s.payout.payoutCurrency = 'USD';
  if (typeof s.payout.minPayoutCredits !== 'number') s.payout.minPayoutCredits = s.minWithdrawal ?? 50;
  if (typeof s.payout.hyperwalletEnabled !== 'boolean') s.payout.hyperwalletEnabled = false;
  if (!s.payout.provider) s.payout.provider = 'hyperwallet';
  return s;
};

export {
  DEFAULT_CREDIT_PACKS,
  DEFAULT_CREDIT_USAGE,
  DEFAULT_CREDIT_USAGE_BLOCKS,
  DEFAULT_CREDIT_EXPIRATION_DAYS,
  DEFAULT_CREDIT_USD_RATE,
  DEFAULT_CREDIT_BANNER_TITLE,
  DEFAULT_CREDIT_BANNER_SUBTITLE,
  DEFAULT_ADVISOR_CREDIT_PRICING,
  DEFAULT_PROMOTION_PLANS
};

export default PlatformSetting;
