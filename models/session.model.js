import mongoose from 'mongoose';

const { Schema } = mongoose;

export const SESSION_TYPES = ['chat', 'call', 'video'];
export const SESSION_STATUSES = [
  'pending',     // booked, waiting for time
  'consent',     // user accepted recording
  'waiting',     // waiting room (advisor not joined)
  'live',        // ongoing
  'completed',
  'expired',
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
    advisorTimezone: { type: String }, // Zone snapshot; changing a profile never shifts this booking's UTC instant.
    durationMinutes: { type: Number, default: 15 },     // user-selected duration (+ extensions)
    // Set only when a late start had to be shortened so it ends before the
    // advisor's next appointment; holds the originally booked duration.
    bookedDurationMinutes: { type: Number },
    instantStart: { type: Boolean, default: false },

    // LiveKit
    livekitRoom: { type: String, index: true },
    egressId: { type: String },
    recordingStatus: {
      type: String,
      enum: ['pending', 'starting', 'recording', 'completed', 'failed'],
      default: 'pending',
      index: true
    },
    recordingError: { type: String, default: '' },

    // Time tracking
    waitingStartedAt: { type: Date },
    advisorJoinedAt: { type: Date },
    userJoinedAt: { type: Date },
    // Advisor pressed "Start". Billing does NOT begin here; it begins at
    // `startedAt`, once both participants are actually in the session room.
    advisorReadyAt: { type: Date },
    // Last time each participant was seen on the live session screen
    // (heartbeat). Used to decide when both are connected.
    userPresentAt: { type: Date },
    advisorPresentAt: { type: Date },
    // Set only when BOTH participants are connected. Timer and credit
    // charging are measured from here.
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
    servicePayout: { type: Schema.Types.ObjectId, ref: 'Transaction', index: true },

    // Recording / transcript unlock
    recordingUrl: { type: String },
    transcriptUrl: { type: String },
    // Retained for audit/backward compatibility. Call/video recording is mandatory.
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

    // Compliance review
    flagReason: { type: String, default: '' },
    flaggedAt: { type: Date },
    flaggedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    internalNotes: { type: String, default: '' },

    // Reschedule
    rescheduledFrom: { type: Date },
    rescheduleReason: { type: String },
    rescheduledAt: { type: Date },

    // Tip
    tipAmount: { type: Number, default: 0 },
    tipAmountFiatUsd: { type: Number, default: 0 },
    tipNetAmountFiatUsd: { type: Number, default: 0 },
    tipCount: { type: Number, default: 0 },

    // Rating reference
    review: { type: Schema.Types.ObjectId, ref: 'Review' }
  },
  { timestamps: true }
);

sessionSchema.pre('save', function () {
  if (!this.sessionCode) {
    this.sessionCode = 'SES-' + Math.floor(100000 + Math.random() * 900000);
  }
});

const Session = mongoose.model('Session', sessionSchema);
export default Session;
