import { Router } from 'express';
import express from 'express';
import { livekitWebhook, revenueCatWebhook, hyperwalletWebhook } from '../controllers/webhook.controller.js';

const router = Router();

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
