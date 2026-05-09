import mongoose from 'mongoose';

const { Schema } = mongoose;

const planSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, index: true },     // Free, Basic, Premium
    description: { type: String, default: '' },
    audienceLimit: { type: String, default: '' },                          // "Up to 10 employees" — display only
    pricePerMonth: { type: Number, default: 0 },
    benefits: { type: [String], default: [] },
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
