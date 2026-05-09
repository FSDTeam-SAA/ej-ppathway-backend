import 'dotenv/config';
import connectDB from '../config/db.js';
import { ensureSeed } from './ensureSeed.js';

(async () => {
  try {
    await connectDB();
    await ensureSeed();
    console.log('Seeding complete');
    process.exit(0);
  } catch (e) {
    console.error('Seeding failed', e);
    process.exit(1);
  }
})();
