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
  deleteWithdrawalRecord,
  getMyPayoutAccount,
  setupMyPayoutAccount,
  addMyBankAccount,
  addMyPaypalAccount,
  removeMyPayoutMethod
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

// Advisor self-service payout account (Hyperwallet)
router.get('/advisor/payout-account', getMyPayoutAccount);
router.post('/advisor/payout-account/setup', setupMyPayoutAccount);
router.post('/advisor/payout-account/bank', addMyBankAccount);
router.post('/advisor/payout-account/paypal', addMyPaypalAccount);
router.delete('/advisor/payout-account/method', removeMyPayoutMethod);

export default router;
