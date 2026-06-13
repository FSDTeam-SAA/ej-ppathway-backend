import { StatusCodes } from 'http-status-codes';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import generateOTP from '../utils/generateOTP.js';
import { signAccessToken, signRefreshToken, signResetToken, verifyResetToken, verifyRefreshToken } from '../utils/jwt.js';
import { sendOtpEmail } from '../services/email.service.js';
import User from '../models/user.model.js';
import Wallet from '../models/wallet.model.js';
import AdvisorApplication from '../models/advisorApplication.model.js';
import { getPlatformSettings } from '../models/platformSetting.model.js';
import { uploadBufferToCloudinary } from '../services/upload.service.js';
import { detectCountry } from '../utils/geo.js';
import { getCountryCurrencyCode } from '../services/countryCurrency.service.js';

const OTP_EXPIRES_MIN = 10;

const buildAuthResponse = (user) => {
  const payload = { sub: user._id.toString(), role: user.role };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
    user
  };
};

const hashOtp = (otp) => crypto.createHash('sha256').update(otp).digest('hex');

const parseJsonField = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const toArrayField = (value) => {
  const parsed = parseJsonField(value, value);
  if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  if (typeof parsed === 'string') {
    return parsed
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
};

const toPricingField = (body = {}) => {
  const parsed = parseJsonField(body.pricing, {});
  return {
    chatPerMin: Number(parsed?.chatPerMin ?? body.chatPerMin ?? 1),
    callPerMin: Number(parsed?.callPerMin ?? body.callPerMin ?? 1.2),
    videoPerMin: Number(parsed?.videoPerMin ?? body.videoPerMin ?? 1.5)
  };
};

const issueOtp = async (user, purpose = 'verify') => {
  const otp = generateOTP(4);
  user.otpHash = hashOtp(otp);
  user.otpPurpose = purpose;
  user.otpExpiresAt = new Date(Date.now() + OTP_EXPIRES_MIN * 60 * 1000);
  user.otpAttempts = 0;
  await user.save();
  // Fire-and-forget — never let email failure block the signup response
  sendOtpEmail(user.email, otp, purpose).catch((err) =>
    console.error(`[email] Failed to send OTP to ${user.email}:`, err.message)
  );
  return otp;
};

// Grants the admin-configured signup free credits to a freshly-created wallet.
// No-op when the platform setting is 0 (or unset).
const grantSignupFreeCredits = async (userId) => {
  // A bonus-credit grant must never fail an otherwise-successful signup, so
  // swallow + log any error rather than letting it bubble to catchAsync.
  try {
    const s = await getPlatformSettings();
    if (s?.signupFreeCredits > 0) {
      await Wallet.findOneAndUpdate({ user: userId }, { $inc: { freeCredits: s.signupFreeCredits } });
    }
  } catch (err) {
    console.error('grantSignupFreeCredits failed:', err?.message || err);
  }
};

// ========== Sign Up ==========
export const signupUser = catchAsync(async (req, res) => {
  const { name, email, phone, phoneNumber, password, confirmPassword, city, state, dateOfBirth } = req.body;
  if (!name || !email || !password) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'name, email, password are required');
  }
  if (confirmPassword && password !== confirmPassword) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Passwords do not match');
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing && existing.isVerified) {
    throw new ApiError(StatusCodes.CONFLICT, 'Email already registered');
  }

  // Country comes from the signup form (ISO-2) when provided, else auto-detected
  // (X-Country / geo CDN). The display currency follows the country's own default
  // currency so prices show the right symbol from the first session.
  const country = detectCountry(req);
  const currency = getCountryCurrencyCode(country) || 'USD';
  const cityVal = (city || '').toString().trim();
  const stateVal = (state || '').toString().trim();
  const phoneVal = phone || phoneNumber;
  const dobVal = (dateOfBirth || '').toString().trim();

  let user;
  if (existing && !existing.isVerified) {
    existing.name = name;
    existing.phone = phoneVal || existing.phone;
    existing.dateOfBirth = dobVal || existing.dateOfBirth;
    existing.password = password;
    existing.country = country || existing.country;
    existing.state = stateVal || existing.state;
    existing.city = cityVal || existing.city;
    existing.currency = currency || existing.currency;
    existing.isVerified = true;
    existing.status = 'active';
    user = existing;
  } else {
    user = new User({
      name,
      email: email.toLowerCase(),
      phone: phoneVal,
      dateOfBirth: dobVal,
      password,
      role: 'user',
      country,
      state: stateVal,
      city: cityVal,
      currency,
      isVerified: true,
      status: 'active'
    });
  }
  await user.save();
  await Wallet.findOneAndUpdate({ user: user._id }, { $setOnInsert: { user: user._id } }, { upsert: true });
  await grantSignupFreeCredits(user._id);

  return sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Signup successful.',
    data: buildAuthResponse(user)
  });
});

// ========== Sign Up as Advisor (creates user + application) ==========
export const signupAdvisor = catchAsync(async (req, res) => {
  const { name, email, phoneNumber, password, confirmPassword, ...rest } = req.body;
  if (!name || !email || !password) throw new ApiError(StatusCodes.BAD_REQUEST, 'Missing required fields');
  if (confirmPassword && password !== confirmPassword) throw new ApiError(StatusCodes.BAD_REQUEST, 'Passwords do not match');

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing && existing.isVerified) throw new ApiError(StatusCodes.CONFLICT, 'Email already registered');

  let user;
  if (existing && !existing.isVerified) {
    existing.name = name;
    existing.phone = phoneNumber || existing.phone;
    existing.password = password;
    existing.role = 'advisor';
    existing.isVerified = true;
    existing.status = 'active';
    user = existing;
  } else {
    user = new User({
      name,
      email: email.toLowerCase(),
      phone: phoneNumber,
      password,
      role: 'advisor',
      isVerified: true,
      status: 'active'
    });
  }
  await user.save();
  await Wallet.findOneAndUpdate({ user: user._id }, { $setOnInsert: { user: user._id } }, { upsert: true });
  await grantSignupFreeCredits(user._id);
  await AdvisorApplication.findOneAndUpdate(
    { user: user._id },
    { $setOnInsert: { user: user._id, ...rest, stage: 'application', status: 'new' } },
    { upsert: true, new: true }
  );

  return sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Advisor signup submitted.',
    data: buildAuthResponse(user)
  });
});

// ========== Public advisor application modal ==========
export const advisorApply = catchAsync(async (req, res) => {
  const body = req.body || {};
  const {
    name,
    email,
    phone,
    phoneNumber,
    password,
    confirmPassword,
    bio = '',
    professionalTitle = 'Spiritual Advisor',
    detailedDescription = '',
    yearsOfExperience = '',
    availableFiveHoursPerDay = '',
    baptizedInHolySpirit = '',
    dateOfBirth,
    address,
    state,
    city,
    zip,
    country
  } = body;

  // Password is now optional: the public application form no longer collects it
  // (bio / profile photo are likewise gathered later during onboarding). When a
  // password is supplied (legacy callers) we still honor it; otherwise we generate
  // an unguessable placeholder so User creation succeeds. The applicant cannot log
  // in until they set their own password during onboarding.
  if (!name || !email) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'name and email are required');
  }
  if (confirmPassword && password !== confirmPassword) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Passwords do not match');
  }
  const effectivePassword = password || crypto.randomBytes(32).toString('hex');

  const normalizedEmail = email.toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail });
  // A logged-in user applying as an advisor uses their OWN account — their
  // already-registered email must NOT be a conflict; we simply convert the
  // account into an advisor. Only a *different* verified account is a conflict.
  const isOwnAccount = req.user && existing && String(req.user._id) === String(existing._id);
  if (existing && existing.isVerified && !isOwnAccount) {
    throw new ApiError(StatusCodes.CONFLICT, 'Email already registered');
  }

  let profilePhoto = existing?.profilePhoto || '';
  let introVideoUrl = '';

  const photoFile = req.files?.profilePhoto?.[0];
  if (photoFile) {
    const uploaded = await uploadBufferToCloudinary(photoFile.buffer, 'advisor-applications/profile-photos', 'image');
    profilePhoto = uploaded.secure_url;
  }

  const introFile = req.files?.introVideo?.[0];
  if (introFile) {
    const uploaded = await uploadBufferToCloudinary(introFile.buffer, 'advisor-applications/intro-videos', 'video');
    introVideoUrl = uploaded.secure_url;
  }

  const iso2 = (country || '').toString().trim().toUpperCase();
  const currency = iso2 ? getCountryCurrencyCode(iso2) || 'USD' : '';

  let user;
  if (existing && (isOwnAccount || !existing.isVerified)) {
    // Reuse the existing account (the logged-in applicant, or an unverified
    // record) and convert it into an advisor — no new signup is created.
    existing.name = name || existing.name;
    existing.phone = phone || phoneNumber || existing.phone;
    // Only overwrite the password when one was explicitly supplied; otherwise keep
    // whatever value the account already holds.
    if (password) existing.password = password;
    existing.role = 'advisor';
    if (profilePhoto) existing.profilePhoto = profilePhoto;
    existing.country = iso2 || existing.country;
    existing.state = state || existing.state;
    existing.city = city || existing.city;
    if (currency) existing.currency = currency;
    existing.isVerified = true;
    existing.status = 'active';
    user = existing;
  } else {
    user = new User({
      name,
      email: normalizedEmail,
      phone: phone || phoneNumber,
      password: effectivePassword,
      role: 'advisor',
      profilePhoto,
      country: iso2,
      state: state || '',
      city: city || '',
      currency,
      isVerified: true,
      status: 'active'
    });
  }

  await user.save();
  await Wallet.findOneAndUpdate({ user: user._id }, { $setOnInsert: { user: user._id } }, { upsert: true });
  await grantSignupFreeCredits(user._id);

  const preRecordedAnswers = parseJsonField(body.preRecordedAnswers, []);
  const applicationUpdate = {
    professionalTitle,
    bio,
    detailedDescription,
    yearsOfExperience: yearsOfExperience || body.experience || '',
    availableFiveHoursPerDay: availableFiveHoursPerDay || '',
    baptizedInHolySpirit: baptizedInHolySpirit || '',
    expertise: toArrayField(body.expertise || body.type),
    styles: toArrayField(body.styles || body.style),
    languages: toArrayField(body.languages || body.language || 'English'),
    pricing: toPricingField(body),
    preRecordedAnswers: Array.isArray(preRecordedAnswers) ? preRecordedAnswers : [],
    stage: 'application',
    status: 'new',
    applicantDetails: {
      dateOfBirth,
      address,
      state,
      city,
      zip,
      country
    }
  };
  if (introVideoUrl) applicationUpdate.introVideoUrl = introVideoUrl;

  const application = await AdvisorApplication.findOneAndUpdate(
    { user: user._id },
    { $set: applicationUpdate, $setOnInsert: { user: user._id, submittedAt: new Date() } },
    { upsert: true, new: true }
  );

  return sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Advisor application submitted.',
    data: { email: user.email, user, application }
  });
});

// ========== Verify OTP ==========
export const verifyOtp = catchAsync(async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) throw new ApiError(StatusCodes.BAD_REQUEST, 'email and otp required');

  const user = await User.findOne({ email: email.toLowerCase() }).select('+otpHash +otpPurpose +otpExpiresAt +otpAttempts');
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  if (!user.otpHash || !user.otpExpiresAt) throw new ApiError(StatusCodes.BAD_REQUEST, 'No OTP requested');
  if (user.otpExpiresAt.getTime() < Date.now()) throw new ApiError(StatusCodes.BAD_REQUEST, 'OTP expired');
  if (user.otpAttempts >= 5) throw new ApiError(StatusCodes.TOO_MANY_REQUESTS, 'Too many attempts. Request a new OTP');

  if (user.otpHash !== hashOtp(otp)) {
    user.otpAttempts += 1;
    await user.save();
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid OTP');
  }

  // For verify purpose
  if (user.otpPurpose === 'verify') {
    user.isVerified = true;
    user.status = 'active';
    user.otpHash = undefined;
    user.otpPurpose = undefined;
    user.otpExpiresAt = undefined;
    user.otpAttempts = 0;
    await user.save();
    return sendResponse(res, { message: 'Email verified successfully', data: buildAuthResponse(user) });
  }

  // For reset purpose: issue a short-lived reset token
  if (user.otpPurpose === 'reset') {
    const resetToken = signResetToken({ sub: user._id.toString(), purpose: 'reset' });
    user.otpHash = undefined;
    user.otpPurpose = undefined;
    user.otpExpiresAt = undefined;
    user.otpAttempts = 0;
    await user.save();
    return sendResponse(res, { message: 'OTP verified. Use reset token to set a new password.', data: { resetToken } });
  }

  return sendResponse(res, { message: 'OTP verified' });
});

// ========== Resend OTP ==========
export const resendOtp = catchAsync(async (req, res) => {
  const { email, purpose = 'verify' } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() }).select('+otpHash');
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  await issueOtp(user, purpose);
  return sendResponse(res, { message: 'OTP re-sent' });
});

// ========== Login ==========
export const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new ApiError(StatusCodes.BAD_REQUEST, 'email and password required');

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user) throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid credentials');
  if (user.status === 'suspended') throw new ApiError(StatusCodes.FORBIDDEN, 'Account suspended');
  if (user.status === 'deactivated') throw new ApiError(StatusCodes.FORBIDDEN, 'Account deactivated');

  const ok = await user.comparePassword(password);
  if (!ok) throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid credentials');

  user.lastLoginAt = new Date();
  await user.save();

  return sendResponse(res, { message: 'Login successful', data: buildAuthResponse(user) });
});

// ========== Forgot Password — send OTP ==========
export const forgotPasswordSendOtp = catchAsync(async (req, res) => {
  const { email } = req.body;
  if (!email) throw new ApiError(StatusCodes.BAD_REQUEST, 'email required');
  const user = await User.findOne({ email: email.toLowerCase() }).select('+otpHash');
  if (!user) {
    // do not reveal
    return sendResponse(res, { message: 'If the email exists, an OTP has been sent.' });
  }
  await issueOtp(user, 'reset');
  return sendResponse(res, { message: 'OTP sent to email' });
});

// ========== Reset password ==========
export const resetPassword = catchAsync(async (req, res) => {
  const { resetToken, newPassword, confirmPassword } = req.body;
  if (!resetToken || !newPassword) throw new ApiError(StatusCodes.BAD_REQUEST, 'resetToken and newPassword required');
  if (confirmPassword && newPassword !== confirmPassword) throw new ApiError(StatusCodes.BAD_REQUEST, 'Passwords do not match');

  let decoded;
  try {
    decoded = verifyResetToken(resetToken);
  } catch {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid or expired reset token');
  }

  const user = await User.findById(decoded.sub).select('+password');
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');

  user.password = newPassword;
  user.mustChangePassword = false;
  await user.save();
  return sendResponse(res, { message: 'Password reset successful' });
});

// ========== Change password (authenticated) ==========
export const changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (!currentPassword || !newPassword) throw new ApiError(StatusCodes.BAD_REQUEST, 'currentPassword and newPassword required');
  if (confirmPassword && newPassword !== confirmPassword) throw new ApiError(StatusCodes.BAD_REQUEST, 'Passwords do not match');

  const user = await User.findById(req.user._id).select('+password');
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  const ok = await user.comparePassword(currentPassword);
  if (!ok) throw new ApiError(StatusCodes.UNAUTHORIZED, 'Current password is incorrect');
  user.password = newPassword;
  user.mustChangePassword = false;
  await user.save();
  return sendResponse(res, { message: 'Password updated' });
});

// ========== Refresh Token ==========
export const refreshToken = catchAsync(async (req, res) => {
  const { refreshToken: rt } = req.body;
  if (!rt) throw new ApiError(StatusCodes.BAD_REQUEST, 'refreshToken required');
  let decoded;
  try {
    decoded = verifyRefreshToken(rt);
  } catch {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid refresh token');
  }
  const user = await User.findById(decoded.sub);
  if (!user) throw new ApiError(StatusCodes.UNAUTHORIZED, 'User no longer exists');
  return sendResponse(res, { message: 'Token refreshed', data: buildAuthResponse(user) });
});

// ========== Me ==========
export const me = catchAsync(async (req, res) => {
  return sendResponse(res, { data: req.user });
});
