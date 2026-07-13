import mongoose from 'mongoose';

const { Schema } = mongoose;

export const TIERS = ['silver', 'gold', 'platinum'];
export const PROFILE_REVIEW_STATUSES = ['pending_review', 'approved', 'rejected'];

const dayScheduleSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    from: { type: String, default: '09:00' },
    to: { type: String, default: '18:00' },
    slots: {
      type: [
        new Schema(
          {
            from: { type: String, default: '09:00' },
            to: { type: String, default: '18:00' }
          },
          { _id: false }
        )
      ],
      default: undefined
    }
  },
  { _id: false }
);

const dateAvailabilitySchema = new Schema(
  {
    unavailable: { type: Boolean, default: false },
    slots: {
      type: [
        new Schema(
          {
            from: { type: String, default: '09:00' },
            to: { type: String, default: '18:00' }
          },
          { _id: false }
        )
      ],
      default: undefined
    }
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

    // Public profile presentation (Psychic Source-style detail screen).
    // Reader's public extension/handle shown next to the name (e.g. "x3615").
    psychicExtension: { type: String, default: '', trim: true },
    // Free-text "Tools" line (e.g. "Tarot, Oracle Cards" or "Can Read Without Tools").
    tools: { type: String, default: '', trim: true },
    // Short pull-quote surfaced under the bio.
    wordsOfWisdom: { type: String, default: '', trim: true },
    // Customer endorsement counts grouped by topic, shown as a bulleted tally.
    endorsements: {
      type: [
        new Schema(
          {
            category: { type: String, required: true, trim: true },
            count: { type: Number, default: 0, min: 0 }
          },
          { _id: false }
        )
      ],
      default: []
    },

    audioMessageUrl: { type: String, default: '' },
    introVideoUrl: { type: String, default: '' },

    pricing: {
      chatPerMin: { type: Number, default: 0 },
      callPerMin: { type: Number, default: 0 },
      videoPerMin: { type: Number, default: 0 }
    },
    sessionTypes: {
      chat: { type: Boolean, default: true },
      call: { type: Boolean, default: true },
      video: { type: Boolean, default: true }
    },

    // Availability
    autoOnlineMode: { type: Boolean, default: false },
    availabilitySettings: {
      minNoticeMinutes: { type: Number, default: 0, min: 0 },
      bookingWindowDays: { type: Number, default: 30, min: 1 },
      bufferMinutes: { type: Number, default: 0, min: 0 },
      defaultDurationMinutes: { type: Number, default: 15, min: 1 },
      sameDayBooking: { type: Boolean, default: true }
    },
    availabilityTemplates: {
      type: [
        new Schema(
          {
            id: { type: String, required: true, trim: true },
            name: { type: String, required: true, trim: true },
            weeklySchedule: { type: Schema.Types.Mixed, default: () => ({}) },
            createdAt: { type: Date, default: Date.now }
          },
          { _id: false }
        )
      ],
      default: []
    },
    weeklySchedule: {
      monday: { type: dayScheduleSchema, default: () => ({}) },
      tuesday: { type: dayScheduleSchema, default: () => ({}) },
      wednesday: { type: dayScheduleSchema, default: () => ({}) },
      thursday: { type: dayScheduleSchema, default: () => ({}) },
      friday: { type: dayScheduleSchema, default: () => ({}) },
      saturday: { type: dayScheduleSchema, default: () => ({}) },
      sunday: { type: dayScheduleSchema, default: () => ({}) }
    },
    dateAvailability: { type: Map, of: dateAvailabilitySchema, default: () => ({}) },

    isOnline: { type: Boolean, default: false, index: true },
    lastSeenAt: { type: Date },

    // Admin marks advisors that appear in the homepage "Select a Verified Advisor" rail
    isFeaturedOnHome: { type: Boolean, default: false, index: true },

    profileReviewStatus: {
      type: String,
      enum: PROFILE_REVIEW_STATUSES,
      default: 'pending_review',
      index: true
    },
    profileRejectionReason: { type: String, default: '' },
    profileSubmittedAt: { type: Date },
    profileReviewedAt: { type: Date },
    profileReviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    // Stats
    tier: { type: String, enum: TIERS, default: 'silver', index: true },
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
      plan: { type: String },
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
