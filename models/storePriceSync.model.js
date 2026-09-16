import mongoose from 'mongoose';

const { Schema } = mongoose;

export const STORE_PRICE_SYNC_STATUSES = [
  'apple_queued',
  'apple_submitting',
  'apple_pending',
  'apple_confirmed',
  'google_updating',
  'google_pending',
  'completed',
  'manual_review',
  'failed',
  'cancelled'
];

const timelineSchema = new Schema({
  status: { type: String, required: true },
  message: { type: String, default: '' },
  at: { type: Date, default: Date.now }
}, { _id: false });

const storePriceSyncSchema = new Schema({
  packId: { type: String, required: true, trim: true, index: true },
  packLabel: { type: String, required: true, trim: true },
  appleProductId: { type: String, required: true, trim: true },
  googleProductId: { type: String, required: true, trim: true },
  previousPriceUsd: { type: Number, required: true },
  targetPriceUsd: { type: Number, required: true },
  status: { type: String, enum: STORE_PRICE_SYNC_STATUSES, default: 'apple_queued', index: true },
  active: { type: Boolean, default: true, index: true },
  requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  appleScheduleId: { type: String, default: '' },
  appleSubmittedAt: { type: Date },
  appleConfirmedAt: { type: Date },
  appleObservedPriceUsd: { type: Number },
  appleConsecutiveMatches: { type: Number, default: 0 },
  googleSubmittedAt: { type: Date },
  googleConfirmedAt: { type: Date },
  googleObservedPriceUsd: { type: Number },
  googleConsecutiveMatches: { type: Number, default: 0 },
  nextCheckAt: { type: Date },
  lastCheckedAt: { type: Date },
  lastError: { type: String, default: '' },
  timeline: { type: [timelineSchema], default: [] },
  completedAt: { type: Date }
}, { timestamps: true });

storePriceSyncSchema.index(
  { packId: 1, active: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);
storePriceSyncSchema.index({ createdAt: -1 });

const StorePriceSync = mongoose.model('StorePriceSync', storePriceSyncSchema);
export default StorePriceSync;
