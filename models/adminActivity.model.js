import mongoose from 'mongoose';

const { Schema } = mongoose;

// Audit trail of admin / sub-admin actions. Surfaced on the Sub Admin Details
// page and filterable by date range, action type and affected user/advisor.
const adminActivitySchema = new Schema(
  {
    admin: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: { type: String, required: true, index: true }, // e.g. advisor.suspend, payout.approve
    description: { type: String, default: '' },
    targetType: {
      type: String,
      enum: ['user', 'advisor', 'subscription', 'payout', 'session', 'cms', 'review', 'sub_admin', 'other'],
      default: 'other',
      index: true
    },
    targetUser: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    meta: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

adminActivitySchema.index({ admin: 1, createdAt: -1 });

const AdminActivity = mongoose.model('AdminActivity', adminActivitySchema);
export default AdminActivity;
