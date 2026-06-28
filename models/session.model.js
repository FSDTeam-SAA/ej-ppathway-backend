import mongoose from 'mongoose';

const { Schema } = mongoose;

export const SESSION_TYPES = ['chat', 'call', 'video'];
export const SESSION_STATUSES = [
  'pending',     // booked, waiting for time
  'consent',     // user accepted recording
  'waiting',     // waiting room (advisor not joined)
  'live',        // ongoing
  'completed',
  'cancelled',
  'no_show',
  'flagged',
  'disputed'
];

const sessionSchema = new Schema(
  {
    sessionCode: { type: String, unique: true, index: true },

    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    advisor: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    type: { type: String, enum: SESSION_TYPES, required: true },
    status: { type: String, enum: SESSION_STATUSES, default: 'pending', index: true },

    // Booking timing
    scheduledFor: { type: Date, index: true },
    durationMinutes: { type: Number, default: 15 },     // user-selected duration
    instantStart: { type: Boolean, default: false },

    // LiveKit
    livekitRoom: { type: String, index: true },
    egressId: { type: String },

    // Time tracking
    waitingStartedAt: { type: Date },
    advisorJoinedAt: { type: Date },
    userJoinedAt: { type: Date },
    startedAt: { type: Date },
    endedAt: { type: Date },
    actualDurationSec: { type: Number, default: 0 },

    // Pricing snapshot in credits
    ratePerMin: { type: Number, required: true },
    estimatedCost: { type: Number, default: 0 },

    // Billing
    holdAmount: { type: Number, default: 0 },          // initial credit hold based on duration
    chargedAmount: { type: Number, default: 0 },       // total credits charged from user wallet
    creditsUsed: { type: Number, default: 0 },         // free credits used
    advisorPayout: { type: Number, default: 0 },
    platformCommission: { type: Number, default: 0 },
    commissionPercent: { type: Number, default: 20 },

    // Recording / transcript unlock
    recordingUrl: { type: String },
    transcriptUrl: { type: String },
    recordingConsented: { type: Boolean, default: false },
    recordingPriceUnlocked: { type: Boolean, default: false },
    transcriptPriceUnlocked: { type: Boolean, default: false },
    unlockChargeRecording: { type: Number, default: 5 },
    unlockChargeTranscript: { type: Number, default: 5 },

    // Extension
    extensions: [
      {
        addedAt: { type: Date, default: Date.now },
        minutes: { type: Number },
        cost: { type: Number }
      }
    ],

    // Cancellation
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelReason: { type: String },
    cancelledAt: { type: Date },
    refundIssued: { type: Number, default: 0 },

    // Reschedule
    rescheduledFrom: { type: Date },
    rescheduleReason: { type: String },
    rescheduledAt: { type: Date },

    // Tip
    tipAmount: { type: Number, default: 0 },

    // Rating reference
    review: { type: Schema.Types.ObjectId, ref: 'Review' }
  },
  { timestamps: true }
);

sessionSchema.pre('save', function (next) {
  if (!this.sessionCode) {
    this.sessionCode = 'SES-' + Math.floor(100000 + Math.random() * 900000);
  }
  next();
});

const Session = mongoose.model('Session', sessionSchema);
export default Session;
