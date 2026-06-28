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
    totalSpent: { type: Number, default: 0 },
    totalWithdrawn: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const Wallet = mongoose.model('Wallet', walletSchema);
export default Wallet;
