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

const issueOtp = async (user, purpose = 'verify') => {
  const otp = generateOTP(4);
  user.otpHash = hashOtp(otp);
  user.otpPurpose = purpose;
  user.otpExpiresAt = new Date(Date.now() + OTP_EXPIRES_MIN * 60 * 1000);
  user.otpAttempts = 0;
  await user.save();
  await sendOtpEmail(user.email, otp, purpose);
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
