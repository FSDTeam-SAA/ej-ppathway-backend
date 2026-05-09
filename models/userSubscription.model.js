import mongoose from 'mongoose';

const { Schema } = mongoose;

const userSubscriptionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    plan: { type: Schema.Types.ObjectId, ref: 'Plan', required: true },
    planName: { type: String, required: true },

    status: {
      type: String,
      enum: ['active', 'cancelled', 'expired', 'pending', 'trialing'],
      default: 'pending',
      index: true
    },

    startedAt: { type: Date },
    renewsAt: { type: Date },
    cancelledAt: { type: Date },

    pricePerMonth: { type: Number, default: 0 },

    // Usage counters (resets on renewal)
    usage: {
      chatMinutes: { type: Number, default: 0 },
      callMinutes: { type: Number, default: 0 },
      videoMinutes: { type: Number, default: 0 }
    },

    stripeSubscriptionId: { type: String, index: true, sparse: true },
    stripeCheckoutSessionId: { type: String, index: true, sparse: true }
  },
  { timestamps: true }
);

const UserSubscription = mongoose.model('UserSubscription', userSubscriptionSchema);
export default UserSubscription;
