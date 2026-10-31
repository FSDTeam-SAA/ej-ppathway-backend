import catchAsync from '../utils/catchAsync.js';
import sendResponse from '../utils/sendResponse.js';
import { convertAvailabilityTimezone } from '../services/availabilityTimezone.service.js';

// Authenticated preview only: no database reads, updates or booking side effects.
export const previewAvailabilityTimezone = catchAsync(async (req, res) => {
  return sendResponse(res, { data: convertAvailabilityTimezone(req.body) });
});
