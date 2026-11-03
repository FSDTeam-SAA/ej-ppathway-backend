import assert from 'node:assert/strict';
import test from 'node:test';
import PlatformSetting from '../models/platformSetting.model.js';
import Session from '../models/session.model.js';
import Wallet from '../models/wallet.model.js';
import Transaction from '../models/transaction.model.js';
import { updateCreditSettings } from '../controllers/admin.settings.controller.js';
import { getSession, unlockSessionAsset } from '../controllers/session.controller.js';
import { creditUsageSummary } from '../services/credit.service.js';
import { sessionUnlockPrices, updatedCreditUsage } from '../services/creditUsagePricing.service.js';

const invoke = (handler, body = {}, extra = {}) => new Promise((resolve, reject) => {
  handler(
    { user: { _id: 'buyer', role: 'user' }, params: { id: 'old-session' }, body, ...extra },
    { status() { return this; }, json: resolve },
    reject
  );
});

function mockSettings(t) {
  const settings = new PlatformSetting({
    creditPackCatalogVersion: 2,
    creditUsage: { chatTranscript: 10, sessionRecording: 10, videoRecording: 10, audioRecording: 10 }
  });
  t.mock.method(settings, 'save', async () => settings);
  t.mock.method(PlatformSetting, 'findOne', async () => settings);
  return settings;
}

test('Settings and Credits updates produce the same add-on prices in the wallet guide', async (t) => {
  const settings = mockSettings(t);
  const events = [];
  const app = { get: () => ({ emit: (event) => events.push(event) }) };
  await invoke(updateCreditSettings, {
    creditUsage: { sessionRecording: 5, chatTranscript: 3 }
  }, { app });
  let summary = await creditUsageSummary();
  assert.equal(summary.addOns.audioRecording, 5);
  assert.equal(summary.addOns.videoRecording, 5);
  assert.equal(summary.usageBlocks.find(b => b.id === 'audio_recording').credits, 5);
  assert.equal(summary.usageBlocks.find(b => b.id === 'chat_transcript').credits, 3);

  const blocks = settings.creditUsageBlocks.map(b => b.toObject());
  blocks.find(b => b.id === 'audio_recording').credits = 2;
  blocks.find(b => b.id === 'video_recording').credits = 7;
  blocks.find(b => b.id === 'chat_transcript').credits = 0;
  blocks.find(b => b.id === 'voice_5').credits = 12;
  blocks.find(b => b.id === 'voice_10').isActive = false;
  await invoke(updateCreditSettings, { creditUsageBlocks: blocks }, { app });
  summary = await creditUsageSummary();
  assert.deepEqual(summary.addOns, {
    sessionRecording: 7, videoRecording: 7, audioRecording: 2, chatTranscript: 0
  });
  assert.equal(summary.usageBlocks.find(b => b.id === 'voice_5').credits, 12);
  assert.equal(summary.usageBlocks.some(b => b.id === 'voice_10'), false);
  assert.equal(summary.usageBlocks.find(b => b.id === 'chat_transcript').credits, 0);
  assert.deepEqual(events, ['credits:updated', 'credits:updated']);

  // The Settings form can subsequently set a common audio/video price again.
  await invoke(updateCreditSettings, { creditUsage: { sessionRecording: 4 } });
  summary = await creditUsageSummary();
  assert.equal(summary.addOns.videoRecording, 4);
  assert.equal(summary.addOns.audioRecording, 4);
  assert.equal(summary.addOns.chatTranscript, 0);
  assert.equal(summary.usageBlocks.find(b => b.id === 'video_recording').credits, 4);
});

test('invalid add-on prices are rejected instead of being saved', () => {
  for (const value of [-1, null, '', 'invalid', Infinity]) {
    assert.throws(() => updatedCreditUsage({}, { patch: { audioRecording: value } }),
      { statusCode: 400 });
  }
});

test('locked historical sessions show current prices, while purchased prices stay historical', async (t) => {
  mockSettings(t);
  await invoke(updateCreditSettings, { creditUsage: { sessionRecording: 5, chatTranscript: 2 } });
  const session = {
    _id: 'old-session', user: 'buyer', advisor: 'advisor', status: 'completed', type: 'call',
    unlockChargeRecording: 10, unlockChargeTranscript: 10,
    recordingUrl: 'private-recording', transcriptUrl: 'private-transcript',
    recordingStatus: 'completed', toObject() { return { ...this }; }
  };
  const query = { populate() { return this; }, then(resolve) { return Promise.resolve(session).then(resolve); } };
  t.mock.method(Session, 'findById', () => query);
  t.mock.method(Transaction, 'exists', async () => null);
  const response = await invoke(getSession);
  assert.equal(response.data.unlockChargeRecording, 5);
  assert.equal(response.data.unlockChargeTranscript, 2);
  assert.equal(response.data.recordingUrl, undefined);
  assert.equal(session.unlockChargeRecording, 10); // A read does not rewrite history.
  assert.deepEqual(sessionUnlockPrices({ ...session, recordingPriceUnlocked: true }, {
    audioRecording: 5, videoRecording: 8, chatTranscript: 2
  }), { unlockChargeRecording: 10, unlockChargeTranscript: 2 });
});

for (const [type, asset, price] of [['call', 'recording', 5], ['video', 'recording', 7], ['chat', 'transcript', 0]]) {
  test(`${type} unlock deducts current ${price} credits rather than the old session price`, async (t) => {
    mockSettings(t);
    await invoke(updateCreditSettings, {
      creditUsage: { audioRecording: 5, videoRecording: 7, chatTranscript: 0 }
    });
    const session = {
      _id: 'old-session', sessionCode: 'SES-OLD', user: 'buyer', status: 'completed', type,
      recordingUrl: 'recording', recordingStatus: 'completed',
      unlockChargeRecording: 10, unlockChargeTranscript: 10,
      save: async () => {}, toObject() { return { ...this }; }
    };
    t.mock.method(Session, 'findById', async () => session);
    t.mock.method(Wallet, 'findOne', async () => ({ _id: 'wallet', balance: 100, freeCredits: 0 }));
    const debit = t.mock.method(Wallet, 'findOneAndUpdate', async () => ({}));
    const receipt = t.mock.method(Transaction, 'create', async data => data);
    await invoke(unlockSessionAsset, { asset, expectedCredits: price });
    assert.equal(debit.mock.calls[0].arguments[1].$inc.totalSpent, price);
    assert.equal(receipt.mock.calls[0].arguments[0].amount, price);
    assert.equal(session[asset === 'recording' ? 'unlockChargeRecording' : 'unlockChargeTranscript'], price);
    assert.equal(session[asset === 'recording' ? 'recordingPriceUnlocked' : 'transcriptPriceUnlocked'], true);
    await invoke(unlockSessionAsset, { asset, expectedCredits: price });
    assert.equal(debit.mock.calls.length, 1); // Retrying an unlocked item is free.
  });
}

test('an outdated confirmation is rejected before any debit or receipt', async (t) => {
  mockSettings(t);
  t.mock.method(Session, 'findById', async () => ({
    user: 'buyer', status: 'completed', type: 'call', recordingUrl: 'recording', recordingStatus: 'completed'
  }));
  const debit = t.mock.method(Wallet, 'findOneAndUpdate', async () => ({}));
  const receipt = t.mock.method(Transaction, 'create', async () => ({}));
  await assert.rejects(invoke(unlockSessionAsset, { asset: 'recording', expectedCredits: 5 }), {
    statusCode: 409, message: 'The unlock price has changed. Please review the updated price and try again.'
  });
  assert.equal(debit.mock.calls.length, 0);
  assert.equal(receipt.mock.calls.length, 0);
});
