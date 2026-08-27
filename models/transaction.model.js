import mongoose from 'mongoose';

const { Schema } = mongoose;

export const TX_TYPES = [
  'credit_pack_purchase',  // user purchased a fixed credit pack
  'wallet_topup',          // user added funds via Stripe
  'session_charge',        // user charged for a session
  'session_refund',        // user refunded
  'tip',                   // user tipped advisor
  'tip_fiat',              // user tipped advisor via store IAP/local currency
  'unlock_recording',      // user paid to unlock recording
  'unlock_transcript',     // user paid to unlock transcript
  'subscription',          // user paid for subscription
  'subscription_refund',
  'credit_expiration',
  'free_credit_grant',     // admin granted credits
  'advisor_earning',       // advisor earned from session
  'advisor_tip',
  'advisor_tip_fiat',
  'advisor_payout',        // advisor withdrew funds
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
    sourceTransaction: { type: Schema.Types.ObjectId, ref: 'Transaction', index: true },
    subscription: { type: Schema.Types.ObjectId, ref: 'UserSubscription' },
    plan: { type: Schema.Types.ObjectId, ref: 'Plan' },

    amount: { type: Number, required: true },           // amount actually charged, in `currency`
    currency: { type: String, default: 'usd' },         // ISO-4217 (lowercase ok)
    country: { type: String, uppercase: true, trim: true },
    amountUsd: { type: Number },                        // equivalent base USD amount (for reporting)
    provider: { type: String, enum: ['stripe', 'paypal', 'internal', 'revenuecat', 'hyperwallet'], default: 'stripe', index: true },
    description: { type: String, default: '' },

    // Store / IAP links
    iapProductId: { type: String, index: true, sparse: true },
    iapPlatform: { type: String, enum: ['ios', 'android', 'app_store', 'play_store', 'unknown'], default: undefined, index: true },
    storeTransactionId: { type: String, unique: true, index: true, sparse: true },
    revenueCatPurchaseId: { type: String, index: true, sparse: true },
    // RevenueCat revenue breakdown. Store-tip advisor earnings use
    // netProceedsUsd; amount/amountUsd retain the initiating purchase values.
    localGrossAmount: { type: Number },
    localCommissionAmount: { type: Number },
    localTaxAmount: { type: Number },
    localNetProceeds: { type: Number },
    grossAmountUsd: { type: Number },
    commissionAmountUsd: { type: Number },
    taxAmountUsd: { type: Number },
    netProceedsUsd: { type: Number },

    // Stripe links
    stripePaymentIntentId: { type: String, index: true, sparse: true },
    stripeCheckoutSessionId: { type: String, index: true, sparse: true },
    stripeChargeId: { type: String },
    stripeRefundId: { type: String },

    // PayPal links
    paypalOrderId: { type: String, index: true, sparse: true },
    paypalCaptureId: { type: String },

    // Withdrawal
    withdrawalMethod: { type: String, default: 'stripe_connect' }, // 'hyperwallet_bank' | 'hyperwallet_paypal' | 'manual' | ...
    withdrawalStatus: {
      type: String,
      enum: ['requested', 'approved', 'processing', 'paid', 'failed', 'rejected'],
      default: undefined,
      index: true
    },
    withdrawalRequestedAt: { type: Date },
    withdrawalApprovedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    withdrawalRejectedReason: { type: String },
    withdrawalFailureReason: { type: String },
    withdrawalProcessedAt: { type: Date },  // when sent to Hyperwallet
    withdrawalPaidAt: { type: Date },        // when Hyperwallet reported COMPLETED

    // Payout valuation (advisor earnings are held in credits; payouts move USD)
    payoutCredits: { type: Number },        // credits deducted from advisor earnings
    payoutTipUsd: { type: Number },         // fiat-tip USD held for this payout
    payoutRateUsd: { type: Number },        // USD per credit used for this payout

    // Hyperwallet links
    hyperwalletUserToken: { type: String, index: true, sparse: true },
    hyperwalletPaymentToken: { type: String, index: true, sparse: true },
    hyperwalletStatus: { type: String },    // raw Hyperwallet payment status

    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

transactionSchema.pre('save', function () {
  if (!this.txCode) {
    this.txCode = 'TXN-' + Math.floor(1000 + Math.random() * 9000) + Date.now().toString().slice(-4);
  }
});

const Transaction = mongoose.model('Transaction', transactionSchema);
export default Transaction;
