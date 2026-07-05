import mongoose from 'mongoose';

const { Schema } = mongoose;

export const NOTIF_TYPES = [
  'session_request',
  'session_confirmed',
  'session_cancelled',
  'session_rescheduled',
  'session_started',
  'session_updated',
  'session_completed',
  'new_review',
  'new_message',
  'payment_update',
  'payout_update',
  'advisor_application',
  'admin_announcement',
  'tip_received',
  'low_balance',
  'free_credits_granted'
];

const notificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: NOTIF_TYPES, required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    data: { type: Schema.Types.Mixed },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date }
  },
  { timestamps: true }
);

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
