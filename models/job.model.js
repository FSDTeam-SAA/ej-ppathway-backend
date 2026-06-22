import mongoose from 'mongoose';

const { Schema } = mongoose;

export const JOB_STATUSES = ['pending', 'processing', 'completed', 'failed'];

const jobSchema = new Schema(
  {
    type: { type: String, required: true, index: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: JOB_STATUSES,
      default: 'pending',
      index: true
    },
    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 3, min: 1 },
    runAt: { type: Date, default: Date.now, index: true },
    lockedAt: { type: Date },
    completedAt: { type: Date },
    failedAt: { type: Date },
    lastError: { type: String, default: '' },
    result: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

jobSchema.index({ status: 1, runAt: 1, createdAt: 1 });
jobSchema.index({ type: 1, status: 1, runAt: 1 });

const Job = mongoose.model('Job', jobSchema);
export default Job;
