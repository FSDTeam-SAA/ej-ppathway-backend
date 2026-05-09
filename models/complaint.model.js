import mongoose from 'mongoose';

const { Schema } = mongoose;

export const COMPLAINT_TYPES = [
  'payment_deducted_session_did_not_happen',
  'advisor_did_not_join_session',
  'advisor_ended_30min_session_in_5min',
  'double_charge_occurred',
  'session_failed_but_money_deducted',
  'advisor_cancelled_after_payment',
  'others'
];

export const SAFETY_TYPES = [
  'advisor_rude_or_abusive_behavior',
  'harassment_or_inappropriate_language',
  'advisor_asked_for_outside_payment',
  'fake_advisor_profile',
  'scam_or_fraud_attempt',
  'sexual_or_inappropriate_content',
  'privacy_violation',
  'advisor_gave_harmful_or_unsafe_advice',
  'spam_or_suspicious_activity'
];

export const COMPLAINT_STATUSES = ['pending', 'reviewing', 'complete', 'reject'];
export const COMPLAINT_KIND = ['complain', 'safety_report'];

const complaintSchema = new Schema(
  {
    kind: { type: String, enum: COMPLAINT_KIND, required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    advisor: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    session: { type: Schema.Types.ObjectId, ref: 'Session', index: true },

    issueType: { type: String, required: true },
    description: { type: String, default: '' },
    documents: { type: [String], default: [] }, // urls

    status: { type: String, enum: COMPLAINT_STATUSES, default: 'pending', index: true },
    resolutionNote: { type: String },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date }
  },
  { timestamps: true }
);

const Complaint = mongoose.model('Complaint', complaintSchema);
export default Complaint;
