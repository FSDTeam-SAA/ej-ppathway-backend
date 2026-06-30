import { receiveWebhookEvent } from '../config/livekit.js';
import { resolveRecordingUrl } from '../services/recording.service.js';
import Session from '../models/session.model.js';
import Transaction from '../models/transaction.model.js';
import Wallet from '../models/wallet.model.js';
import User from '../models/user.model.js';
import { findCreditPackByRevenueCatProduct } from '../services/credit.service.js';

/**
 * Resolve which session an egress event belongs to.
 * We store `egressId` on the session at start time, and rooms are named `session_<id>`.
 */
const findSessionForEgress = async (egressInfo) => {
  if (!egressInfo) return null;
  if (egressInfo.egressId) {
    const byEgress = await Session.findOne({ egressId: egressInfo.egressId });
    if (byEgress) return byEgress;
  }
  const room = egressInfo.roomName || '';
  if (room.startsWith('session_')) {
    const id = room.replace('session_', '');
    const byId = await Session.findById(id).catch(() => null);
    if (byId) return byId;
  }
  if (egressInfo.roomName) {
    return Session.findOne({ livekitRoom: egressInfo.roomName });
  }
  return null;
};

/**
 * LiveKit webhook receiver.
 * Configure LiveKit (livekit.yaml) to POST events here:
 *   webhook:
 *     api_key: <LIVEKIT_API_KEY>
 *     urls:
 *       - https://your-backend/api/v1/webhooks/livekit
 *
 * Mounted with a raw body parser so the signature can be verified.
 */
export const livekitWebhook = async (req, res) => {
  try {
    const event = await receiveWebhookEvent(req.body, req.get('Authorization'));
    if (!event) return res.status(200).json({ ok: true, skipped: true });

    if (event.event === 'egress_ended' || event.event === 'egress_updated') {
      const info = event.egressInfo;
      // EGRESS_COMPLETE === 3 in the LiveKit enum; also accept the string form.
      const status = info?.status;
      const isComplete = status === 3 || status === 'EGRESS_COMPLETE';

      if (info && (event.event === 'egress_ended' || isComplete)) {
        const session = await findSessionForEgress(info);
        if (session) {
          // S3 -> use reported location; local -> upload to Cloudinary (or serve locally).
          const url = await resolveRecordingUrl(info);
          if (url) {
            session.recordingUrl = url;
            await session.save();
          }
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('livekitWebhook error', e?.message);
    // Always 200 so LiveKit does not endlessly retry on our parsing bugs.
    return res.status(200).json({ ok: false });
  }
};

const revenueCatSecretMatches = (req) => {
  const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!expected) return true;
  const auth = String(req.get('Authorization') || '').trim();
  return auth === expected || auth === `Bearer ${expected}`;
};

export const revenueCatWebhook = async (req, res) => {
  try {
    if (!revenueCatSecretMatches(req)) {
      return res.status(401).json({ ok: false, message: 'Unauthorized' });
    }

    const event = req.body?.event || req.body;
    const type = String(event?.type || '').toUpperCase();
    const shouldCredit = ['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'VIRTUAL_CURRENCY_TRANSACTION'].includes(type);
    if (!shouldCredit) return res.status(200).json({ ok: true, skipped: true });

    const productId = event.product_id || event.productId || event.product_identifier;
    const transactionId = event.transaction_id || event.transactionId || event.id;
    const appUserId = event.app_user_id || event.appUserId;
    if (!productId || !transactionId || !appUserId) {
      return res.status(200).json({ ok: false, skipped: true, message: 'Missing purchase identifiers' });
    }

    const existing = await Transaction.findOne({
      provider: 'revenuecat',
      'metadata.revenueCatTransactionId': String(transactionId)
    });
    if (existing) return res.status(200).json({ ok: true, duplicate: true });

    const pack = await findCreditPackByRevenueCatProduct(productId);
    if (!pack) return res.status(200).json({ ok: false, skipped: true, message: 'Unknown product id' });

    const user = await User.findById(appUserId);
    if (!user) return res.status(200).json({ ok: false, skipped: true, message: 'Unknown app user id' });

    const credited = Number(pack.totalCredits || pack.credits || 0);
    const wallet = await Wallet.findOneAndUpdate(
      { user: user._id },
      { $inc: { balance: credited }, $setOnInsert: { user: user._id } },
      { new: true, upsert: true }
    );

    const price = Number(event.price || event.price_in_purchased_currency || pack.priceUsd);
    const currency = String(event.currency || event.currency_code || 'usd').toLowerCase();

    await Transaction.create({
      type: 'credit_pack_purchase',
      status: 'completed',
      provider: 'revenuecat',
      user: user._id,
      amount: Number.isFinite(price) ? price : pack.priceUsd,
      currency,
      amountUsd: pack.priceUsd,
      description: `${pack.label} credit pack via RevenueCat`,
      metadata: {
        packId: pack.id,
        credits: pack.credits,
        bonusCredits: pack.bonusCredits || 0,
        totalCredits: credited,
        revenueCatProductId: productId,
        revenueCatTransactionId: transactionId,
        revenueCatStore: event.store,
        revenueCatEventType: type
      }
    });

    return res.status(200).json({ ok: true, walletBalance: wallet.balance });
  } catch (e) {
    console.error('revenueCatWebhook error', e?.message);
    return res.status(200).json({ ok: false });
  }
};

export default { livekitWebhook, revenueCatWebhook };
