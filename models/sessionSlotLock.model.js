import mongoose from 'mongoose';

const { Schema } = mongoose;

const sessionSlotLockSchema = new Schema(
  {
    advisor: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    session: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
    slotStart: { type: Date, required: true, index: true }
  },
  { timestamps: true }
);

sessionSlotLockSchema.index({ advisor: 1, slotStart: 1 }, { unique: true });

const SessionSlotLock = mongoose.model('SessionSlotLock', sessionSlotLockSchema);
export default SessionSlotLock;
