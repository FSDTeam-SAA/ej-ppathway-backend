import StorePriceSync from '../models/storePriceSync.model.js';
import { getPlatformSettings } from '../models/platformSetting.model.js';
import { enqueueJob, registerJobHandler } from './jobQueue.service.js';
import {
  getAppleInAppPurchaseCurrentPrice,
  getGoogleOneTimeProductCurrentPrice,
  updateAppleInAppPurchasePrice,
  updateGoogleOneTimeProductPrice
} from './storePricing.service.js';

export const STORE_PRICE_APPLE_SUBMIT_JOB = 'store-price.apple-submit';
export const STORE_PRICE_APPLE_POLL_JOB = 'store-price.apple-poll';
export const STORE_PRICE_GOOGLE_UPDATE_JOB = 'store-price.google-update';
export const STORE_PRICE_GOOGLE_POLL_JOB = 'store-price.google-poll';

const applePollMs = () => Number(process.env.STORE_PRICE_APPLE_POLL_MS || 5 * 60 * 1000);
const googlePollMs = () => Number(process.env.STORE_PRICE_GOOGLE_POLL_MS || 60 * 1000);
const matchPollMs = () => Number(process.env.STORE_PRICE_MATCH_CONFIRM_MS || 60 * 1000);
const appleTimeoutMs = () => Number(process.env.STORE_PRICE_APPLE_TIMEOUT_MS || 24 * 60 * 60 * 1000);
const googleTimeoutMs = () => Number(process.env.STORE_PRICE_GOOGLE_TIMEOUT_MS || 6 * 60 * 60 * 1000);

const samePrice = (left, right) => Math.round(Number(left) * 100) === Math.round(Number(right) * 100);
const event = (status, message) => ({ status, message, at: new Date() });

const loadActiveSync = async (syncId) => StorePriceSync.findOne({ _id: syncId, active: true });

const enqueue = (type, syncId, delayMs = 0) => enqueueJob(
  type,
  { syncId: String(syncId) },
  { delayMs, maxAttempts: 1 }
);

const markManualReview = async (sync, message) => {
  sync.status = 'manual_review';
  sync.lastError = message;
  sync.nextCheckAt = null;
  sync.timeline.push(event('manual_review', message));
  await sync.save();
};

const finalizeSync = async (sync) => {
  const settings = await getPlatformSettings();
  const pack = settings.creditPacks.find((item) => item.id === sync.packId);
  if (pack) {
    pack.priceUsd = sync.targetPriceUsd;
    await settings.save();
  }
  const tipPack = settings.tipPacks?.find((item) => item.id === sync.packId);
  if (tipPack) {
    tipPack.amountUsd = sync.targetPriceUsd;
    await settings.save();
  }
  const now = new Date();
  sync.status = 'completed';
  sync.active = false;
  sync.completedAt = now;
  sync.nextCheckAt = null;
  sync.lastError = '';
  sync.timeline.push(event('completed', 'Apple and Google prices are confirmed'));
  await sync.save();
};

const handleAppleSubmit = async ({ syncId }) => {
  const sync = await loadActiveSync(syncId);
  if (!sync || !['apple_queued', 'apple_submitting'].includes(sync.status)) return { skipped: true };
  sync.status = 'apple_submitting';
  sync.lastError = '';
  sync.timeline.push(event('apple_submitting', `Submitting $${sync.targetPriceUsd.toFixed(2)} to Apple`));
  await sync.save();

  try {
    const result = await updateAppleInAppPurchasePrice({
      productId: sync.appleProductId,
      priceUsd: sync.targetPriceUsd
    });
    const now = new Date();
    sync.appleScheduleId = result.scheduleId || '';
    sync.appleSubmittedAt ||= now;
    sync.appleObservedPriceUsd = result.priceUsd;
    sync.status = 'apple_pending';
    sync.appleConsecutiveMatches = result.unchanged ? 1 : 0;
    sync.nextCheckAt = new Date(Date.now() + (result.unchanged ? matchPollMs() : applePollMs()));
    sync.timeline.push(event(
      'apple_pending',
      result.unchanged ? 'Apple already reports the target price; confirming once more' : 'Apple accepted the price schedule; waiting for the current price to change'
    ));
    await sync.save();
    await enqueue(STORE_PRICE_APPLE_POLL_JOB, sync._id, result.unchanged ? matchPollMs() : applePollMs());
    return { submitted: true, unchanged: Boolean(result.unchanged) };
  } catch (error) {
    sync.status = 'failed';
    sync.active = false;
    sync.lastError = error?.message || String(error);
    sync.timeline.push(event('failed', `Apple submission failed: ${sync.lastError}`));
    await sync.save();
    return { submitted: false, error: sync.lastError };
  }
};

const handleApplePoll = async ({ syncId }) => {
  const sync = await loadActiveSync(syncId);
  if (!sync || sync.status !== 'apple_pending') return { skipped: true };
  const now = new Date();
  try {
    const current = await getAppleInAppPurchaseCurrentPrice({ productId: sync.appleProductId });
    const matched = samePrice(current.priceUsd, sync.targetPriceUsd);
    sync.lastCheckedAt = now;
    sync.appleObservedPriceUsd = current.priceUsd;
    sync.appleConsecutiveMatches = matched ? sync.appleConsecutiveMatches + 1 : 0;
    sync.lastError = '';
    if (sync.appleConsecutiveMatches >= 2) {
      sync.status = 'apple_confirmed';
      sync.appleConfirmedAt = now;
      sync.nextCheckAt = null;
      sync.timeline.push(event('apple_confirmed', `Apple US price confirmed at $${current.priceUsd.toFixed(2)}`));
      await sync.save();
      await enqueue(STORE_PRICE_GOOGLE_UPDATE_JOB, sync._id);
      return { confirmed: true, priceUsd: current.priceUsd };
    }
    if (now.getTime() - sync.createdAt.getTime() >= appleTimeoutMs()) {
      await markManualReview(sync, `Apple was not confirmed within the monitoring window; last observed $${current.priceUsd.toFixed(2)}`);
      return { timedOut: true };
    }
    const delay = matched ? matchPollMs() : applePollMs();
    sync.nextCheckAt = new Date(Date.now() + delay);
    await sync.save();
    await enqueue(STORE_PRICE_APPLE_POLL_JOB, sync._id, delay);
    return { confirmed: false, priceUsd: current.priceUsd };
  } catch (error) {
    sync.lastCheckedAt = now;
    sync.lastError = error?.message || String(error);
    const delay = applePollMs();
    sync.nextCheckAt = new Date(Date.now() + delay);
    await sync.save();
    await enqueue(STORE_PRICE_APPLE_POLL_JOB, sync._id, delay);
    return { error: sync.lastError };
  }
};

const handleGoogleUpdate = async ({ syncId }) => {
  const sync = await loadActiveSync(syncId);
  if (!sync || !['apple_confirmed', 'google_updating', 'manual_review'].includes(sync.status)) return { skipped: true };
  sync.status = 'google_updating';
  sync.lastError = '';
  sync.timeline.push(event('google_updating', `Apple is confirmed; submitting $${sync.targetPriceUsd.toFixed(2)} to Google`));
  await sync.save();
  try {
    const result = await updateGoogleOneTimeProductPrice({
      productId: sync.googleProductId,
      priceUsd: sync.targetPriceUsd
    });
    const now = new Date();
    sync.googleSubmittedAt ||= now;
    sync.googleObservedPriceUsd = result.priceUsd;
    sync.googleConsecutiveMatches = result.unchanged ? 1 : 0;
    sync.status = 'google_pending';
    sync.nextCheckAt = new Date(Date.now() + matchPollMs());
    sync.timeline.push(event(
      'google_pending',
      result.unchanged ? 'Google already reports the target price; confirming once more' : 'Google accepted the update; waiting for propagation'
    ));
    await sync.save();
    await enqueue(STORE_PRICE_GOOGLE_POLL_JOB, sync._id, matchPollMs());
    return { submitted: true, unchanged: Boolean(result.unchanged) };
  } catch (error) {
    await markManualReview(sync, `Google update failed: ${error?.message || String(error)}`);
    return { submitted: false, error: sync.lastError };
  }
};

const handleGooglePoll = async ({ syncId }) => {
  const sync = await loadActiveSync(syncId);
  if (!sync || sync.status !== 'google_pending') return { skipped: true };
  const now = new Date();
  try {
    const current = await getGoogleOneTimeProductCurrentPrice({ productId: sync.googleProductId });
    const matched = samePrice(current.priceUsd, sync.targetPriceUsd);
    sync.lastCheckedAt = now;
    sync.googleObservedPriceUsd = current.priceUsd;
    sync.googleConsecutiveMatches = matched ? sync.googleConsecutiveMatches + 1 : 0;
    sync.lastError = '';
    if (sync.googleConsecutiveMatches >= 2) {
      sync.googleConfirmedAt = now;
      sync.timeline.push(event('google_confirmed', `Google US price confirmed at $${current.priceUsd.toFixed(2)}`));
      await finalizeSync(sync);
      return { confirmed: true, priceUsd: current.priceUsd };
    }
    if (now.getTime() - (sync.googleSubmittedAt || sync.createdAt).getTime() >= googleTimeoutMs()) {
      await markManualReview(sync, `Google was not confirmed within the monitoring window; last observed $${current.priceUsd.toFixed(2)}`);
      return { timedOut: true };
    }
    const delay = matched ? matchPollMs() : googlePollMs();
    sync.nextCheckAt = new Date(Date.now() + delay);
    await sync.save();
    await enqueue(STORE_PRICE_GOOGLE_POLL_JOB, sync._id, delay);
    return { confirmed: false, priceUsd: current.priceUsd };
  } catch (error) {
    sync.lastCheckedAt = now;
    sync.lastError = error?.message || String(error);
    const delay = googlePollMs();
    sync.nextCheckAt = new Date(Date.now() + delay);
    await sync.save();
    await enqueue(STORE_PRICE_GOOGLE_POLL_JOB, sync._id, delay);
    return { error: sync.lastError };
  }
};

export const registerStorePriceSyncJobHandlers = () => {
  registerJobHandler(STORE_PRICE_APPLE_SUBMIT_JOB, handleAppleSubmit);
  registerJobHandler(STORE_PRICE_APPLE_POLL_JOB, handleApplePoll);
  registerJobHandler(STORE_PRICE_GOOGLE_UPDATE_JOB, handleGoogleUpdate);
  registerJobHandler(STORE_PRICE_GOOGLE_POLL_JOB, handleGooglePoll);
};

export const startCoordinatedStorePriceSync = async ({ pack, targetPriceUsd, requestedBy }) => {
  const existing = await StorePriceSync.findOne({ packId: pack.id, active: true });
  if (existing) return { sync: existing, created: false };
  const sync = await StorePriceSync.create({
    packId: pack.id,
    packLabel: pack.label,
    appleProductId: pack.appleProductId,
    googleProductId: pack.googleProductId,
    previousPriceUsd: pack.priceUsd,
    targetPriceUsd,
    requestedBy,
    status: 'apple_queued',
    timeline: [event('apple_queued', 'Coordinated update queued; Google will wait for Apple confirmation')]
  });
  await enqueue(STORE_PRICE_APPLE_SUBMIT_JOB, sync._id);
  return { sync, created: true };
};

export const listStorePriceSyncs = async () => StorePriceSync.find({})
  .sort({ createdAt: -1 })
  .limit(50)
  .lean();

export const runStorePriceSyncCheckNow = async (syncId) => {
  const sync = await StorePriceSync.findById(syncId);
  if (!sync || !sync.active) return sync;
  if (sync.status === 'apple_pending') await enqueue(STORE_PRICE_APPLE_POLL_JOB, sync._id);
  else if (sync.status === 'google_pending') await enqueue(STORE_PRICE_GOOGLE_POLL_JOB, sync._id);
  else if (sync.status === 'manual_review' && sync.appleConfirmedAt) await enqueue(STORE_PRICE_GOOGLE_UPDATE_JOB, sync._id);
  else if (sync.status === 'manual_review') {
    sync.status = 'apple_pending';
    sync.lastError = '';
    sync.timeline.push(event('apple_pending', 'Apple monitoring resumed manually'));
    await sync.save();
    await enqueue(STORE_PRICE_APPLE_POLL_JOB, sync._id);
  }
  return sync;
};
