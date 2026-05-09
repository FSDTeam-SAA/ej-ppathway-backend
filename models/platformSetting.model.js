import mongoose from 'mongoose';

const { Schema } = mongoose;

// Singleton-like document holding global commission/tier rates and other platform settings.
const platformSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    commissions: {
      bronze: { type: Number, default: 20 },
      silver: { type: Number, default: 15 },
      gold: { type: Number, default: 10 }
    },
    tierThresholds: {
      bronze: { sessions: { type: Number, default: 50 }, ratings: { type: Number, default: 4 }, retention: { type: Number, default: 70 } },
      silver: { sessions: { type: Number, default: 150 }, ratings: { type: Number, default: 4.5 }, retention: { type: Number, default: 80 } },
      gold: { sessions: { type: Number, default: 300 }, ratings: { type: Number, default: 4.8 }, retention: { type: Number, default: 85 } }
    },
    promotionPlans: {
      basic: { price: { type: Number, default: 29 }, days: { type: Number, default: 7 } },
      pro: { price: { type: Number, default: 79 }, days: { type: Number, default: 14 } },
      premium: { price: { type: Number, default: 149 }, days: { type: Number, default: 30 } }
    },
    minWithdrawal: { type: Number, default: 50 },
    sessionLowBalanceThresholdMin: { type: Number, default: 2 }
  },
  { timestamps: true }
);

const PlatformSetting = mongoose.model('PlatformSetting', platformSettingSchema);

export const getPlatformSettings = async () => {
  let s = await PlatformSetting.findOne({ key: 'global' });
  if (!s) s = await PlatformSetting.create({ key: 'global' });
  return s;
};

export default PlatformSetting;
