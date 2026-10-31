import mongoose from 'mongoose';
import User from '../models/user.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import ApiError from '../utils/ApiError.js';

// The timezone and its converted wall-clock schedule form one atomic update.
export const saveAvailabilityTimezone = async ({ userId, previousTimezone, userPatch, profilePatch }) => {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const timezoneFilter = previousTimezone === 'UTC'
        ? { $or: [{ timezone: 'UTC' }, { timezone: { $exists: false } }, { timezone: null }, { timezone: '' }] }
        : { timezone: previousTimezone };
      const user = await User.findOneAndUpdate({ _id: userId, ...timezoneFilter },
        { $set: userPatch }, { session, returnDocument: 'after', runValidators: true });
      if (!user) throw new ApiError(409, 'Availability timezone changed. Reload the profile before saving.');
      const profile = await AdvisorProfile.findOneAndUpdate({ user: userId },
        { $set: profilePatch, $setOnInsert: { user: userId } },
        { session, returnDocument: 'after', upsert: true, runValidators: true });
      result = { user, profile };
    });
    return result;
  } finally { await session.endSession(); }
};
