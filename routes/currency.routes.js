import { Router } from 'express';
import { optionalAuth } from '../middlewares/auth.js';
import { listCurrencies, myCurrency, currencyCatalog } from '../controllers/currency.controller.js';

const router = Router();

// Public list of supported currencies (country picker, etc.)
router.get('/', listCurrencies);

// Public ISO-4217 currency catalog (code → symbol + name) for symbol rendering.
router.get('/catalog', currencyCatalog);

// Resolve the caller's currency by country (auto-detect; persisted when logged in).
router.get('/me', optionalAuth(), myCurrency);

export default router;
