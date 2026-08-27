import mongoose from 'mongoose';

const { Schema } = mongoose;

const walletSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    balance: { type: Number, default: 0 },         // for users: purchased spendable credits
    freeCredits: { type: Number, default: 0 },     // free credits granted by admin
    pendingHold: { type: Number, default: 0 },     // credits held during sessions
    earningsBalance: { type: Number, default: 0 }, // for advisors
    pendingPayouts: { type: Number, default: 0 },  // pending payout requests
    totalEarned: { type: Number, default: 0 },
    // Store tips never enter the credit ledger. RevenueCat's USD proceeds
    // (after estimated store commission and taxes) are tracked separately.
    tipEarningsBalanceUsd: { type: Number, default: 0 },
    pendingTipPayoutUsd: { type: Number, default: 0 },
    totalTipEarnedUsd: { type: Number, default: 0 },
    totalTipWithdrawnUsd: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    totalWithdrawn: { type: Number, default: 0 },
    // Private idempotency ledger for consumable IAP credit fulfillment. Keeping
    // the key on the wallet makes the balance increment and receipt claim one
    // atomic MongoDB update, even when RevenueCat retries a webhook.
    processedIapTransactionIds: { type: [String], default: [], select: false }
  },
  { timestamps: true }
);

const Wallet = mongoose.model('Wallet', walletSchema);
export default Wallet;
