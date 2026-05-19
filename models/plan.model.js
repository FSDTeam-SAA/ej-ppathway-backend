import mongoose from 'mongoose';

const { Schema } = mongoose;

const planSchema = new Schema(
  {
    // Stable identifier matched by the frontend cards: instant | clarity | priority
    tier: {
      type: String,
      enum: ['instant', 'clarity', 'priority'],
      required: true,
      unique: true,
      index: true
    },
    name: { type: String, required: true, unique: true, index: true },     // "Instant Access" / "Clarity Access" / "Priority Access"
    tagline: { type: String, default: '' },                                // e.g. "No monthly commitment"
    description: { type: String, default: '' },
    audienceLimit: { type: String, default: '' },                          // display-only ("Best for first-time...")
    pricePerMonth: { type: Number, default: 0 },
    ctaLabel: { type: String, default: '' },                               // "Start Instantly" / "Choose Clarity" / "Upgrade plan"

    benefits: { type: [String], default: [] },                             // bullet list shown on the card

    // Included usage allotments (null = unlimited or not applicable).
    included: {
      textMessages: { type: Number, default: null },
      voiceMinutes: { type: Number, default: null },
      videoMinutes: { type: Number, default: null },
      recordingsPerMonth: { type: Number, default: null }
    },

    // Per-use pricing (only meaningful for the pay-as-you-go "Instant" tier).
    perUsePricing: {
      textPerSession: { type: Number, default: null },                     // $3 / session
      textSessionMinutes: { type: Number, default: null },                 // 15-min active window
      voicePerMinute: { type: Number, default: null },                     // $4/min
      videoPerMinute: { type: Number, default: null }                      // $7/min
    },

    // Discount applied to extra usage beyond the included allotment.
    overageDiscountPercent: { type: Number, default: 0 },                  // 0, 15, 20, 25

    // Feature flags surfaced as bullets on the card.
    priorityMatching: { type: Boolean, default: false },
    skipWait: { type: Boolean, default: false },
    topRatedGuidesAccess: { type: Boolean, default: false },

    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },

    // Stripe
    stripePriceId: { type: String, index: true, sparse: true },
    stripeProductId: { type: String, sparse: true }
  },
  { timestamps: true }
);

const Plan = mongoose.model('Plan', planSchema);
export default Plan;
