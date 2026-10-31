import { Router } from 'express';
import express from 'express';
import { flutterwaveWebhook } from '../controllers/flutterwave.controller.js';
import { livekitWebhook, revenueCatWebhook, hyperwalletWebhook } from '../controllers/webhook.controller.js';

const router = Router();
router.post('/flutterwave', express.json({ limit: '1mb' }), flutterwaveWebhook);
router.post('/flutterwave/refunds', express.json({ limit: '1mb' }), flutterwaveWebhook);

/**
 * LiveKit posts events as `application/webhook+json`. We need the raw body
 * (not JSON-parsed) so the WebhookReceiver can verify the signature.
 */
router.post(
  '/livekit',
  express.raw({ type: () => true, limit: '1mb' }),
  livekitWebhook
);

router.post(
  '/revenuecat',
  express.json({ type: () => true, limit: '1mb' }),
  revenueCatWebhook
);

router.post(
  '/hyperwallet',
  express.json({ type: () => true, limit: '1mb' }),
  hyperwalletWebhook
);

export default router;
