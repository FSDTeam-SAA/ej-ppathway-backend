import mongoose from 'mongoose';

const { Schema } = mongoose;

export const APP_STAGES = [
  'application',
  'pre_recorded_interview',
  'live_interview',
  'contract'
];

export const APP_STATUSES = [
  'new',
  'pending_review',
  'live_interview',
  'under_review',
  'awaiting_submission',
  'scheduled',
  'awaiting_signature',
  'awaiting_approval',
  'approved',
  'rejected'
];

const advisorApplicationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Step 1: basic info / application
    professionalTitle: { type: String, default: 'I am a professional advisor' },
    bio: { type: String, default: '' },
    detailedDescription: { type: String, default: '' },
    yearsOfExperience: { type: String, default: '' },
    // Availability answer collected on the public application form ('yes' / 'no').
    availableFiveHoursPerDay: { type: String, default: '' },
    baptizedInHolySpirit: { type: String, default: '' },
    expertise: { type: [String], default: [] },
    styles: { type: [String], default: [] },
    languages: { type: [String], default: ['English'] },
    introVideoUrl: { type: String, default: '' },

    // Pre-recorded Q&A
    preRecordedAnswers: [
      {
        question: { type: String },
        answer: { type: String }
      }
    ],

    // Live interview
    liveInterview: {
      scheduledAt: { type: Date },
      roomName: { type: String },
      notes: { type: String }
    },

    // Contract
    contract: {
      sentAt: { type: Date },
      signedAt: { type: Date },
      url: { type: String }, // original contract PDF (Cloudinary)
      signerName: { type: String },
      signerIp: { type: String },
      signatureImageUrl: { type: String }, // captured signature image
      signedPdfUrl: { type: String } // stamped, signed copy
    },

    // Pricing offered (used after approval)
    pricing: {
      chatPerMin: { type: Number, default: 0 },
      callPerMin: { type: Number, default: 0 },
      videoPerMin: { type: Number, default: 0 }
    },

    applicantDetails: {
      dateOfBirth: { type: String, default: '' },
      address: { type: String, default: '' },
      state: { type: String, default: '' },
      city: { type: String, default: '' },
      zip: { type: String, default: '' },
      country: { type: String, default: '' }
    },

    stage: { type: String, enum: APP_STAGES, default: 'application', index: true },
    status: { type: String, enum: APP_STATUSES, default: 'new', index: true },

    rejectionReason: { type: String },
    submittedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

const AdvisorApplication = mongoose.model('AdvisorApplication', advisorApplicationSchema);
export default AdvisorApplication;
