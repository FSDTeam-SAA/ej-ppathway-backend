import { Router } from 'express';
import { auth, optionalAuth } from '../middlewares/auth.js';
import {
  listPlans,
  myActivePlan,
  subscribeToPlan,
  stripeSubscribeSuccess,
  stripeSubscribeCancel,
  paypalSubscribeSuccess,
  paypalSubscribeCancel,
  cancelMySubscription
} from '../controllers/subscription.controller.js';

const router = Router();

// public success/cancel (Stripe + PayPal)
router.get('/checkout/success', stripeSubscribeSuccess);
router.get('/checkout/cancel', stripeSubscribeCancel);
router.get('/paypal/success', paypalSubscribeSuccess);
router.get('/paypal/cancel', paypalSubscribeCancel);

// Plans are priced for the caller's country — optionalAuth lets us use a saved
// country for logged-in users while still serving anonymous visitors.
router.get('/plans', optionalAuth(), listPlans);

router.use(auth());
router.get('/me', myActivePlan);
router.post('/subscribe', subscribeToPlan);
router.post('/cancel', cancelMySubscription);

export default router;
