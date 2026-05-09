import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import {
  listPlans,
  myActivePlan,
  subscribeToPlan,
  stripeSubscribeSuccess,
  stripeSubscribeCancel,
  cancelMySubscription
} from '../controllers/subscription.controller.js';

const router = Router();

// public success/cancel
router.get('/checkout/success', stripeSubscribeSuccess);
router.get('/checkout/cancel', stripeSubscribeCancel);

router.get('/plans', listPlans);

router.use(auth());
router.get('/me', myActivePlan);
router.post('/subscribe', subscribeToPlan);
router.post('/cancel', cancelMySubscription);

export default router;
