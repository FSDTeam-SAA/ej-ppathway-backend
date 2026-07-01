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
  { id: 'session_recording', activity: 'Session Recording', sessionType: 'add_on', durationMinutes: 0, credits: 5, isActive: true, sortOrder: 8 },
  { id: 'chat_transcript', activity: 'Chat Transcript', sessionType: 'add_on', durationMinutes: 0, credits: 5, isActive: true, sortOrder: 9 }
];

const DEFAULT_CREDIT_EXPIRATION_DAYS = 60;
const DEFAULT_CREDIT_USD_RATE = 1;

const DEFAULT_ADVISOR_CREDIT_PRICING = {
  chatPerMin: 1 / 3,
  callPerMin: 1,
  videoPerMin: 4 / 3
};

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
    promotionPlans: {
      basic: { price: { type: Number, default: 29 }, days: { type: Number, default: 7 }, impressionsPerDay: { type: Number, default: 100 } },
      pro: { price: { type: Number, default: 79 }, days: { type: Number, default: 14 }, impressionsPerDay: { type: Number, default: 500 } },
      premium: { price: { type: Number, default: 149 }, days: { type: Number, default: 30 }, impressionsPerDay: { type: Number, default: 0 } }
    },
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
    creditPacks: { type: [creditPackSchema], default: () => DEFAULT_CREDIT_PACKS },
    creditUsage: {
      chatTranscript: { type: Number, default: DEFAULT_CREDIT_USAGE.chatTranscript, min: 0 },
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
  if (typeof s.creditUsdRate !== 'number') s.creditUsdRate = DEFAULT_CREDIT_USD_RATE;
  if (typeof s.creditExpirationDays !== 'number') s.creditExpirationDays = DEFAULT_CREDIT_EXPIRATION_DAYS;
  if (!Array.isArray(s.creditPacks) || s.creditPacks.length === 0) s.creditPacks = DEFAULT_CREDIT_PACKS;
  if (!s.creditUsage) s.creditUsage = DEFAULT_CREDIT_USAGE;
  if (typeof s.creditUsage.chatTranscript !== 'number') s.creditUsage.chatTranscript = DEFAULT_CREDIT_USAGE.chatTranscript;
  if (typeof s.creditUsage.sessionRecording !== 'number') s.creditUsage.sessionRecording = DEFAULT_CREDIT_USAGE.sessionRecording;
  if (!Array.isArray(s.creditUsageBlocks) || s.creditUsageBlocks.length === 0) s.creditUsageBlocks = DEFAULT_CREDIT_USAGE_BLOCKS;
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
  DEFAULT_ADVISOR_CREDIT_PRICING
};

export default PlatformSetting;
