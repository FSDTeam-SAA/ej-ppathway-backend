import mongoose from 'mongoose';

const { Schema } = mongoose;

export const TX_TYPES = [
  'wallet_topup',          // user added funds via Stripe
  'session_charge',        // user charged for a session
  'session_refund',        // user refunded
  'tip',                   // user tipped advisor
  'unlock_recording',      // user paid to unlock recording
  'unlock_transcript',     // user paid to unlock transcript
  'subscription',          // user paid for subscription
  'subscription_refund',
  'free_credit_grant',     // admin granted credits
  'advisor_earning',       // advisor earned from session
  'advisor_tip',
  'advisor_payout',        // advisor withdrew funds
  'platform_commission',
  'promotion_purchase'
];

export const TX_STATUSES = ['pending', 'completed', 'failed', 'cancelled', 'refunded'];

const transactionSchema = new Schema(
  {
    txCode: { type: String, unique: true, index: true },
    type: { type: String, enum: TX_TYPES, required: true, index: true },
    status: { type: String, enum: TX_STATUSES, default: 'pending', index: true },

    user: { type: Schema.Types.ObjectId, ref: 'User', index: true }, // who initiated
    advisor: { type: Schema.Types.ObjectId, ref: 'User', index: true }, // beneficiary if applicable
    session: { type: Schema.Types.ObjectId, ref: 'Session', index: true },
    subscription: { type: Schema.Types.ObjectId, ref: 'UserSubscription' },
    plan: { type: Schema.Types.ObjectId, ref: 'Plan' },

    amount: { type: Number, required: true },           // positive amount (sign depends on type)
    currency: { type: String, default: 'usd' },
    description: { type: String, default: '' },

    // Stripe links
    stripePaymentIntentId: { type: String, index: true, sparse: true },
    stripeCheckoutSessionId: { type: String, index: true, sparse: true },
    stripeChargeId: { type: String },
    stripeRefundId: { type: String },

    // Withdrawal
    withdrawalMethod: { type: String, default: 'stripe_connect' },
    withdrawalStatus: { type: String, enum: ['requested', 'approved', 'rejected', 'paid'], default: undefined },
    withdrawalRequestedAt: { type: Date },
    withdrawalApprovedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    withdrawalRejectedReason: { type: String },

    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

transactionSchema.pre('save', function (next) {
  if (!this.txCode) {
    this.txCode = 'TXN-' + Math.floor(1000 + Math.random() * 9000) + Date.now().toString().slice(-4);
  }
  next();
});

const Transaction = mongoose.model('Transaction', transactionSchema);
export default Transaction;
