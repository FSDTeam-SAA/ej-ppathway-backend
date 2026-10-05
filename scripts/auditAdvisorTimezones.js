import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/user.model.js';
import { isValidTimezone } from '../utils/timezone.js';

// Read-only audit. Country is context, never a rule for silently shifting schedules.
try {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const advisors = await User.find({ role: 'advisor' }).select('_id timezone country').lean();
  const review = advisors.filter(user => !isValidTimezone(user.timezone) || user.timezone === 'UTC');
  console.log(JSON.stringify({
    advisorCount: advisors.length,
    requiresConfirmation: review.map(user => ({
      advisorId: String(user._id), country: user.country, timezone: user.timezone,
      reason: isValidTimezone(user.timezone) ? 'UTC may be intentional or a legacy default; advisor confirmation required' : 'Invalid or missing timezone'
    }))
  }, null, 2));
} catch (error) {
  console.error(`Read-only timezone audit failed (${error.name}). No records changed.`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
