import mongoose from 'mongoose';

const { Schema } = mongoose;

export const DISPUTE_TYPES = [
  'payment_deducted_session_did_not_happen',
  'advisor_did_not_join_session',
  'advisor_ended_30min_session_in_5min',
  'double_charge_occurred',
  'session_failed_but_money_deducted',
  'advisor_cancelled_after_payment',
  'others'
];

export const RESOLUTION_OPTIONS = [
  'full_refund',
  'partial_refund',
  'free_reschedule',
  'assign_another_advisor'
];

export const DISPUTE_STATUSES = [
  'open',         // user filed, awaiting admin
  'investigating',
  'resolved',
  'rejected',
  'cancelled'     // user withdrew
];

const disputeSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    advisor: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    session: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },

    disputeType: { type: String, enum: DISPUTE_TYPES, required: true },
    details: { type: String, default: '' },
    expectedResolution: { type: String, enum: RESOLUTION_OPTIONS, required: true },
    documents: { type: [String], default: [] },

    status: { type: String, enum: DISPUTE_STATUSES, default: 'open', index: true },

    resolutionApplied: { type: String, enum: RESOLUTION_OPTIONS },
    refundAmount: { type: Number, default: 0 },
    rescheduleSessionId: { type: Schema.Types.ObjectId, ref: 'Session' },
    reassignedAdvisor: { type: Schema.Types.ObjectId, ref: 'User' },

    resolutionNote: { type: String },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date }
  },
  { timestamps: true }
);

const Dispute = mongoose.model('Dispute', disputeSchema);
export default Dispute;
