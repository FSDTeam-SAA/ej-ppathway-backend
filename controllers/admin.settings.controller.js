import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { getPlatformSettings } from '../models/platformSetting.model.js';

// GET /api/v1/admin/settings/signup-credits
export const getSignupFreeCredits = catchAsync(async (_req, res) => {
  const settings = await getPlatformSettings();
  return sendResponse(res, { data: { signupFreeCredits: settings.signupFreeCredits } });
});

// PATCH /api/v1/admin/settings/signup-credits
export const updateSignupFreeCredits = catchAsync(async (req, res) => {
  const { signupFreeCredits } = req.body;
  const value = Number(signupFreeCredits);
  if (!Number.isFinite(value) || value < 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'signupFreeCredits must be a non-negative number');
  }
  const settings = await getPlatformSettings();
  settings.signupFreeCredits = value;
  await settings.save();
  return sendResponse(res, { message: 'Signup free credits updated', data: { signupFreeCredits: settings.signupFreeCredits } });
});
