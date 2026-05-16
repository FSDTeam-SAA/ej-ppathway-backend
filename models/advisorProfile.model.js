import mongoose from 'mongoose';

const { Schema } = mongoose;

export const TIERS = ['bronze', 'silver', 'gold'];

const dayScheduleSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    from: { type: String, default: '09:00' },
    to: { type: String, default: '18:00' }
  },
  { _id: false }
);

const advisorProfileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },

    professionalTitle: { type: String, default: 'I am a professional advisor' },
    bio: { type: String, default: '' },
    detailedDescription: { type: String, default: '' },
    yearsOfExperience: { type: String, default: '' },

    expertise: { type: [String], default: [] },
    styles: { type: [String], default: [] },
    languages: { type: [String], default: ['English'] },

    introVideoUrl: { type: String, default: '' },

    pricing: {
      chatPerMin: { type: Number, default: 1 },
      callPerMin: { type: Number, default: 1.2 },
      videoPerMin: { type: Number, default: 1.5 }
    },

    // Availability
    autoOnlineMode: { type: Boolean, default: true },
    weeklySchedule: {
      monday: { type: dayScheduleSchema, default: () => ({}) },
      tuesday: { type: dayScheduleSchema, default: () => ({}) },
      wednesday: { type: dayScheduleSchema, default: () => ({}) },
      thursday: { type: dayScheduleSchema, default: () => ({}) },
      friday: { type: dayScheduleSchema, default: () => ({}) },
      saturday: { type: dayScheduleSchema, default: () => ({}) },
      sunday: { type: dayScheduleSchema, default: () => ({}) }
    },

    isOnline: { type: Boolean, default: false, index: true },
    lastSeenAt: { type: Date },

    // Admin marks advisors that appear in the homepage "Select a Verified Advisor" rail
    isFeaturedOnHome: { type: Boolean, default: false, index: true },

    // Stats
    tier: { type: String, enum: TIERS, default: 'bronze', index: true },
    totalSessions: { type: Number, default: 0 },
    completedSessions: { type: Number, default: 0 },
    cancelledSessions: { type: Number, default: 0 },
    totalProphecy: { type: Number, default: 0 },
    repeatClientRate: { type: Number, default: 0 },
    avgResponseSec: { type: Number, default: 0 },
    refundRate: { type: Number, default: 0 },
    avgRating: { type: Number, default: 0 },
    ratingsCount: { type: Number, default: 0 },

    // Per-criteria ratings
    ratingBreakdown: {
      accuracy: { type: Number, default: 0 },
      clarity: { type: Number, default: 0 },
      helpfulness: { type: Number, default: 0 },
      valuable: { type: Number, default: 0 },
      communication: { type: Number, default: 0 },
      professionalism: { type: Number, default: 0 },
      valueForMoney: { type: Number, default: 0 },
      expertise: { type: Number, default: 0 }
    },

    // Earnings
    grossEarnings: { type: Number, default: 0 },
    netEarnings: { type: Number, default: 0 },
    pendingEarnings: { type: Number, default: 0 },

    // Active promotion
    activePromotion: {
      plan: { type: String, enum: ['basic', 'pro', 'premium'] },
      startsAt: { type: Date },
      expiresAt: { type: Date },
      impressions: { type: Number, default: 0 },
      profileViews: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      newClients: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
);

advisorProfileSchema.index({ expertise: 1 });
advisorProfileSchema.index({ styles: 1 });
advisorProfileSchema.index({ tier: 1, avgRating: -1 });

const AdvisorProfile = mongoose.model('AdvisorProfile', advisorProfileSchema);
export default AdvisorProfile;
