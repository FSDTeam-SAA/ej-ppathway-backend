import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import {
  getMyWallet,
  getMyTransactions,
  createTopupCheckout,
  getTopupStatus,
  stripeTopupSuccess,
  stripeTopupCancel,
  requestWithdrawal,
  myEarningsOverview,
  myEarningsHistory,
  myWithdrawalsHistory,
  deleteEarningRecord,
  deleteWithdrawalRecord
} from '../controllers/wallet.controller.js';

const router = Router();

// Public Stripe success/cancel routes (no auth — Stripe redirects user)
router.get('/topup/success', stripeTopupSuccess);
router.get('/topup/cancel', stripeTopupCancel);

router.use(auth());

// User wallet
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
