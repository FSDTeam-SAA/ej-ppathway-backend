import 'dotenv/config';
import connectDB from '../config/db.js';
import User from '../models/user.model.js';
import { getCountryCurrencyCode } from '../services/countryCurrency.service.js';

/**
 * One-off backfill: set each user's display `currency` to their selected
 * country's default ISO-4217 currency. Safe to re-run (idempotent). Going
 * forward this is maintained automatically whenever a country is saved.
 */
(async () => {
  try {
    await connectDB();
    const users = await User.find({ country: { $nin: [null, ''] } })
      .select('_id country currency')
      .lean();

    let updated = 0;
    for (const u of users) {
      const code = getCountryCurrencyCode(u.country);
      if (code && code !== u.currency) {
        await User.updateOne({ _id: u._id }, { $set: { currency: code } });
        updated++;
      }
    }
    console.log(`Currency backfill complete: ${updated}/${users.length} users updated`);
    process.exit(0);
  } catch (e) {
    console.error('Currency backfill failed', e);
    process.exit(1);
  }
})();
