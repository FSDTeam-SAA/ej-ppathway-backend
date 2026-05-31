import { Router } from 'express';
import express from 'express';
import { livekitWebhook } from '../controllers/webhook.controller.js';

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

export default router;
