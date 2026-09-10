import mongoose from 'mongoose';

const { Schema } = mongoose;

const revenueCatIapReceiptSchema = new Schema(
  {
    eventId: { type: String, index: true, sparse: true },
    eventType: { type: String, required: true, index: true },
    productId: { type: String, required: true, index: true },
    transactionId: { type: String, required: true, unique: true, index: true },
    originalTransactionId: { type: String, index: true, sparse: true },
    appUserId: { type: String, required: true, index: true },
    aliases: { type: [String], default: [] },
    environment: { type: String },
    store: { type: String },
    currency: { type: String },
    priceInPurchasedCurrency: { type: Number },
    priceUsd: { type: Number },
    commissionPercentage: { type: Number },
    taxPercentage: { type: Number },
    purchasedAtMs: { type: Number },
    refunded: { type: Boolean, default: false, index: true },
    refundedAt: { type: Date }
  },
  { timestamps: true }
);

const RevenueCatIapReceipt = mongoose.model(
  'RevenueCatIapReceipt',
  revenueCatIapReceiptSchema
);

export default RevenueCatIapReceipt;
