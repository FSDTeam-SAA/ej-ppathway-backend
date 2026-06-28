import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import {
  getMyWallet,
  getCreditPacks,
  getMyTransactions,
  createTopupCheckout,
  getTopupStatus,
  stripeTopupSuccess,
  stripeTopupCancel,
  paypalTopupSuccess,
  paypalTopupCancel,
  requestWithdrawal,
  myEarningsOverview,
  myEarningsHistory,
  myWithdrawalsHistory,
  deleteEarningRecord,
  deleteWithdrawalRecord
} from '../controllers/wallet.controller.js';

const router = Router();

// Public success/cancel routes (no auth — provider redirects user back)
router.get('/topup/success', stripeTopupSuccess);
router.get('/topup/cancel', stripeTopupCancel);
router.get('/paypal/success', paypalTopupSuccess);
router.get('/paypal/cancel', paypalTopupCancel);

router.use(auth());

// User wallet
router.get('/credit-packs', getCreditPacks);
router.get('/me', getMyWallet);
router.get('/transactions', getMyTransactions);
router.post('/topup', createTopupCheckout);
router.get('/topup/status', getTopupStatus);

// Advisor earnings + withdrawals
router.get('/advisor/overview', myEarningsOverview);
router.get('/advisor/earnings', myEarningsHistory);
router.get('/advisor/withdrawals', myWithdrawalsHistory);
router.post('/advisor/withdraw', requestWithdrawal);
router.delete('/advisor/earnings/:id', deleteEarningRecord);
router.delete('/advisor/withdrawals/:id', deleteWithdrawalRecord);

export default router;
