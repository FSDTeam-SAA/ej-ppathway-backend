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
import { uploadBufferToCloudinary } from '../services/upload.service.js';

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

// ========== Sign Up ==========
export const signupUser = catchAsync(async (req, res) => {
  const { name, email, phoneNumber, password, confirmPassword } = req.body;
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

  let user;
  if (existing && !existing.isVerified) {
    existing.name = name;
    existing.phone = phoneNumber || existing.phone;
    existing.password = password;
    user = existing;
  } else {
    user = new User({
      name,
      email: email.toLowerCase(),
      phone: phoneNumber,
      password,
      role: 'user',
      status: 'pending_verification'
    });
  }
  await user.save();
  await Wallet.findOneAndUpdate({ user: user._id }, { $setOnInsert: { user: user._id } }, { upsert: true });
  await issueOtp(user, 'verify');

  return sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Signup successful. OTP sent to email.',
    data: { email: user.email }
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
    user = existing;
  } else {
    user = new User({
      name,
      email: email.toLowerCase(),
      phone: phoneNumber,
      password,
      role: 'advisor',
      status: 'pending_verification'
    });
  }
  await user.save();
  await Wallet.findOneAndUpdate({ user: user._id }, { $setOnInsert: { user: user._id } }, { upsert: true });
  await AdvisorApplication.findOneAndUpdate(
    { user: user._id },
    { $setOnInsert: { user: user._id, ...rest, stage: 'application', status: 'new' } },
    { upsert: true, new: true }
  );

  await issueOtp(user, 'verify');

  return sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Advisor signup submitted. OTP sent to email.',
    data: { email: user.email }
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
    dateOfBirth,
    address,
    city,
    zip,
    country
  } = body;

  if (!name || !email || !password) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'name, email and password are required');
  }
  if (confirmPassword && password !== confirmPassword) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Passwords do not match');
  }

  const normalizedEmail = email.toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing && existing.isVerified) {
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

  let user;
  if (existing && !existing.isVerified) {
    existing.name = name;
    existing.phone = phone || phoneNumber || existing.phone;
    existing.password = password;
    existing.role = 'advisor';
    existing.profilePhoto = profilePhoto;
    existing.location = [city, country].filter(Boolean).join(', ') || address || existing.location;
    existing.status = 'pending_verification';
    user = existing;
  } else {
    user = new User({
      name,
      email: normalizedEmail,
      phone: phone || phoneNumber,
      password,
      role: 'advisor',
      profilePhoto,
      location: [city, country].filter(Boolean).join(', ') || address || '',
      status: 'pending_verification'
    });
  }

  await user.save();
  await Wallet.findOneAndUpdate({ user: user._id }, { $setOnInsert: { user: user._id } }, { upsert: true });

  const preRecordedAnswers = parseJsonField(body.preRecordedAnswers, []);
  const applicationUpdate = {
    professionalTitle,
    bio,
    detailedDescription,
    yearsOfExperience: yearsOfExperience || body.experience || '',
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

  await issueOtp(user, 'verify');

  return sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Advisor application submitted. OTP sent to email.',
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

  if (!user.isVerified) {
    await issueOtp(user, 'verify');
    throw new ApiError(StatusCodes.FORBIDDEN, 'Account not verified. OTP re-sent to email.');
  }

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
