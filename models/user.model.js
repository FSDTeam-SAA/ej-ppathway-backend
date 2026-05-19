import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { Schema } = mongoose;

const ROLES = ['user', 'advisor', 'admin', 'sub_admin'];
const STATUSES = ['active', 'suspended', 'deactivated', 'pending_verification'];
const SUB_ADMIN_PERMS = [
  'users.manage',
  'advisors.manage',
  'advisors.approve',
  'sessions.manage',
  'compliance.manage',
  'finance.manage',
  'subscriptions.manage',
  'cms.manage',
  'chats.manage',
  'faq.manage',
  'reviews.manage',
  'sub_admins.manage'
];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    phone: { type: String, trim: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'user', index: true },

    profilePhoto: { type: String, default: '' },
    location: { type: String, default: '' },
    timezone: { type: String, default: 'UTC' },
    language: { type: String, default: 'English' },

    isVerified: { type: Boolean, default: false },
    status: { type: String, enum: STATUSES, default: 'pending_verification', index: true },
    suspendedReason: { type: String },
    suspendedAt: { type: Date },

    // OTP for verification & password reset
    otpHash: { type: String, select: false },
    otpPurpose: { type: String, enum: ['verify', 'reset'], select: false },
    otpExpiresAt: { type: Date, select: false },
    otpAttempts: { type: Number, default: 0, select: false },
    resetToken: { type: String, select: false },
    resetTokenExpiresAt: { type: Date, select: false },

    // Sub-admin specific
    permissions: { type: [String], default: [] },

    // Stripe identifiers
    stripeCustomerId: { type: String, index: true, sparse: true },
    stripeConnectId: { type: String, index: true, sparse: true },
    stripeConnectVerified: { type: Boolean, default: false },

    // Notifications preferences
    notifPrefs: {
      email: { type: Boolean, default: true },
      newSessions: { type: Boolean, default: true },
      newMessages: { type: Boolean, default: true },
      paymentUpdates: { type: Boolean, default: true },
      push: { type: Boolean, default: true }
    },

    fcmTokens: { type: [String], default: [] },

    // Onboarding questionnaire answers ("Help us personalize your experience")
    preferences: {
      seekingHelpWith: { type: [String], default: [] },           // step 1 — multi
      guidanceType: { type: String, default: '' },                // step 2 — single
      connectionMethods: { type: [String], default: [] },         // step 3 — multi (Text/Voice Call/Video Call)
      atmosphere: { type: String, default: '' },                  // step 4 — single
      guidanceFrequency: { type: String, default: '' },           // step 5 — single
      tailoredAreas: { type: [String], default: [] },             // step 6 — multi
      guideQualityPriority: { type: String, default: '' },        // step 7 — single
      usedPlatformBefore: { type: Boolean, default: null },       // step 8 — Yes/No
      completedAt: { type: Date }
    },
    onboardingCompleted: { type: Boolean, default: false, index: true },

    lastLoginAt: { type: Date }
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(Number(process.env.BCRYPT_SALT_ROUNDS) || 12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject({ virtuals: true });
  delete obj.password;
  delete obj.otpHash;
  delete obj.otpPurpose;
  delete obj.otpExpiresAt;
  delete obj.otpAttempts;
  delete obj.resetToken;
  delete obj.resetTokenExpiresAt;
  return obj;
};

export const SUB_ADMIN_PERMISSIONS = SUB_ADMIN_PERMS;
export const USER_ROLES = ROLES;
export const USER_STATUSES = STATUSES;

const User = mongoose.model('User', userSchema);
export default User;
