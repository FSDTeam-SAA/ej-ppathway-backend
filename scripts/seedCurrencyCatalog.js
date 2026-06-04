import 'dotenv/config';
import connectDB from '../config/db.js';
import { seedCurrencyCatalog } from '../services/currencyCatalog.service.js';

(async () => {
  try {
    await connectDB();
    const { inserted, total } = await seedCurrencyCatalog();
    console.log(`Currency catalog seed complete: ${inserted} inserted / ${total} processed`);
    process.exit(0);
  } catch (e) {
    console.error('Currency catalog seed failed', e);
    process.exit(1);
  }
})();
