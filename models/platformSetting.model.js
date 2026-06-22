import mongoose from 'mongoose';

const { Schema } = mongoose;

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
    sessionLowBalanceThresholdMin: { type: Number, default: 2 },
    signupFreeCredits: { type: Number, default: 0, min: 0 }
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
  return s;
};

export default PlatformSetting;
