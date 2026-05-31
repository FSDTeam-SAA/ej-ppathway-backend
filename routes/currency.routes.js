import { Router } from 'express';
import { optionalAuth } from '../middlewares/auth.js';
import { listCurrencies, myCurrency } from '../controllers/currency.controller.js';

const router = Router();

// Public list of supported currencies (country picker, etc.)
router.get('/', listCurrencies);

// Resolve the caller's currency by country (auto-detect; persisted when logged in).
router.get('/me', optionalAuth(), myCurrency);

export default router;
