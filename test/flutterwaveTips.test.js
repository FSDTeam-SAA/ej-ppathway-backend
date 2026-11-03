import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Transaction from '../models/transaction.model.js';
import Session from '../models/session.model.js';
import Wallet from '../models/wallet.model.js';
import Currency from '../models/currency.model.js';
import PlatformSetting from '../models/platformSetting.model.js';
import Job from '../models/job.model.js';
import { flutterwaveTipsEnabled, flutterwaveTipCatalog, createFlutterwaveTipCheckout,
  validateFlutterwaveTip, fulfillFlutterwaveTip, applyFlutterwaveTipRefund, refundDuplicateFlutterwaveTip } from '../services/flutterwaveTip.service.js';
import { flutterwaveWebhook, flutterwaveReturn } from '../controllers/flutterwave.controller.js';
import { tipStatus } from '../controllers/flutterwaveTip.controller.js';
import { advisorTipBreakdown } from '../utils/advisorTip.js';
import { updateCreditSettings } from '../controllers/admin.settings.controller.js';

const purchase = () => ({ _id: 'checkout', type: 'tip_checkout', provider: 'flutterwave', status: 'pending',
  user: 'buyer', advisor: 'advisor', session: 'session', amount: 7500, amountUsd: 5,
  currency: 'ngn', flutterwaveReference: 'PP-TIP-ref', metadata: { ngnPerUsd: 1500 } });
const payment = () => ({ id: 123, tx_ref: 'PP-TIP-ref', status: 'successful', amount: 7500,
  currency: 'NGN', app_fee: 100 });
function env(t) {
  for (const [key, value] of Object.entries({ FLUTTERWAVE_TIPS_ENABLED: 'true',
    FLUTTERWAVE_SECRET_KEY: 'FLWSECK_TEST-fixture', FLUTTERWAVE_WEBHOOK_SECRET: 'secret', SERVER_URL: 'https://api.example.test' })) {
    const before = process.env[key]; process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
}

test('all countries receive explicit NGN prices; zero and inactive tip packs stay hidden', async t => {
  env(t);
  for (const country of ['AX', 'US', 'GB', '', undefined]) assert.equal(flutterwaveTipsEnabled({ country }), true);
  assert.equal(flutterwaveTipsEnabled({ country: 'NG' }), true);
  assert.equal(flutterwaveTipsEnabled({ country: 'Nigeria' }), true);
  t.mock.method(PlatformSetting, 'findOne', async () => new PlatformSetting({ creditPackCatalogVersion: 2, tipPacks: [
    { id: 'tip_5', label: 'Tip 5', amountUsd: 5, flutterwavePriceNgn: 4200 },
    { id: 'tip_10', label: 'Tip 10', amountUsd: 10, flutterwavePriceNgn: 9000 },
    { id: 'tip_20', label: 'Tip 20', amountUsd: 20, flutterwavePriceNgn: 0 },
    { id: 'tip_50', label: 'Tip 50', amountUsd: 50, flutterwavePriceNgn: 50000, isActive: false }
  ] }));
  const catalog = await flutterwaveTipCatalog({ country: 'NG' });
  assert.deepEqual(catalog.packs.map(p => p.amountNgn), [4200, 9000]);
  for (const country of ['AX', 'US', 'GB', '', undefined]) {
    assert.deepEqual(await flutterwaveTipCatalog({ country }), catalog);
  }
});

test('global tips still require the feature flag and provider configuration', async t => {
  env(t);
  process.env.FLUTTERWAVE_TIPS_ENABLED = 'false';
  assert.deepEqual(await flutterwaveTipCatalog({ country: 'AX' }), { enabled: false, currency: 'NGN', packs: [] });
  await assert.rejects(createFlutterwaveTipCheckout({ user: { _id: 'buyer', country: 'AX' } }), { statusCode: 503 });
  process.env.FLUTTERWAVE_TIPS_ENABLED = 'true';
  process.env.FLUTTERWAVE_SECRET_KEY = '';
  assert.equal(flutterwaveTipsEnabled({ country: 'NG' }), false);
});

test('checkout snapshots NGN amount and rate, and a retry returns the same hosted payment', async t => {
  env(t);
  t.mock.method(Session, 'findById', async () => ({ _id: 'session', user: 'buyer', advisor: 'advisor', status: 'completed', sessionCode: 'SES-1' }));
  t.mock.method(PlatformSetting, 'findOne', async () => new PlatformSetting({ creditPackCatalogVersion: 2,
    tipPacks: [{ id: 'tip_5', label: 'Tip 5', amountUsd: 5, flutterwavePriceNgn: 7500 }] }));
  t.mock.method(Currency, 'findOne', () => ({ lean: async () => ({ usdRate: 2000 }) }));
  const originalDb = mongoose.connection.db;
  mongoose.connection.db = { admin: () => ({ command: async () => ({ setName: 'test' }) }) };
  t.after(() => { mongoose.connection.db = originalDb; });
  t.mock.method(Transaction, 'init', async () => {});
  let stored;
  t.mock.method(Transaction, 'findOne', () => ({ select: async () => stored }));
  t.mock.method(Transaction, 'exists', async () => false);
  t.mock.method(Transaction, 'create', async data => (stored = { ...data, _id: 'receipt', save: async () => {} }));
  t.mock.method(Job, 'create', async () => ({}));
  const requests = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.flutterwave.com/v3/payments');
    const data = JSON.parse(options.body);
    assert.equal(data.amount, 7500);
    assert.equal(data.currency, 'NGN');
    assert.match(data.redirect_url, /wallet\/flutterwave\/return$/);
    return { ok: true, json: async () => ({ status: 'success', data: { link: 'https://checkout.flutterwave.com/tip' } }) };
  });
  const args = { user: { _id: 'buyer', country: 'AX', email: 'buyer@example.test' }, sessionId: 'session', packId: 'tip_5', expectedAmountNgn: 7500, requestId: 'request_1234567890' };
  const first = await createFlutterwaveTipCheckout(args);
  assert.equal(first.amountUsd, 3.75); // NGN checkout price is independent of the $5 IAP price.
  assert.equal(first.metadata.ngnPerUsd, 2000);
  assert.equal(first.country, 'AX');
  assert.equal((await createFlutterwaveTipCheckout(args))._id, first._id);
  assert.equal(requests.mock.calls.length, 1);
  await assert.rejects(createFlutterwaveTipCheckout({ ...args, sessionId: 'another-session' }), { statusCode: 409 });
  assert.equal((await createFlutterwaveTipCheckout({ ...args, user: { ...args.user, country: 'US' } }))._id, first._id);
});

test('admin tip NGN price survives save/reload and legacy IAP-only edits', async t => {
  env(t);
  const settings = new PlatformSetting({ creditPackCatalogVersion: 2 });
  t.mock.method(PlatformSetting, 'findOne', async () => settings);
  const save = t.mock.method(settings, 'save', async () => settings);
  const update = tip => new Promise((resolve, reject) => updateCreditSettings({ body: { tipPacks: [tip] } },
    { status() { return this; }, json: resolve }, reject));
  const tip = { id: 'tip_5', label: 'Tip 5', amountUsd: 5, flutterwavePriceNgn: 4500.50 };
  const result = await update(tip);
  assert.equal(result.data.tipPacks[0].flutterwavePriceNgn, 4500.50);
  assert.equal(settings.tipPacks[0].amountUsd, 5);
  assert.equal((await flutterwaveTipCatalog({ country: 'NG' })).packs[0].amountNgn, 4500.50);
  await update({ id: 'tip_5', label: 'Updated IAP', amountUsd: 10 });
  assert.equal(settings.tipPacks[0].flutterwavePriceNgn, 4500.50);
  assert.equal(settings.tipPacks[0].amountUsd, 10);
  assert.equal(save.mock.calls.length, 2);
  await update({ ...tip, flutterwavePriceNgn: 0 });
  assert.equal((await flutterwaveTipCatalog({ country: 'NG' })).packs.length, 0);
});

test('invalid NGN tip prices cannot be saved or charged, and stale checkout prices are rejected', async t => {
  env(t);
  const settings = new PlatformSetting({ creditPackCatalogVersion: 2,
    tipPacks: [{ id: 'tip_5', label: 'Tip 5', amountUsd: 5, flutterwavePriceNgn: 5000 }] });
  t.mock.method(PlatformSetting, 'findOne', async () => settings);
  const save = t.mock.method(settings, 'save', async () => settings);
  const tip = { id: 'tip_5', label: 'Tip 5', amountUsd: 5 };
  for (const value of [-1, NaN, Infinity, 1.001]) {
    await assert.rejects(new Promise((resolve, reject) => updateCreditSettings({ body: {
      tipPacks: [{ ...tip, flutterwavePriceNgn: value }]
    } }, { status() { return this; }, json: resolve }, reject)), { statusCode: 400 });
  }
  assert.equal(save.mock.calls.length, 0);
  t.mock.method(Session, 'findById', async () => ({ _id: 'session', user: 'buyer', advisor: 'advisor', status: 'completed' }));
  t.mock.method(Transaction, 'findOne', () => ({ select: async () => null }));
  t.mock.method(Transaction, 'exists', async () => false);
  const provider = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not charge'); });
  const args = { user: { _id: 'buyer', country: 'NG' }, sessionId: 'session', packId: 'tip_5', expectedAmountNgn: 4500, requestId: 'request_1234567890' };
  await assert.rejects(createFlutterwaveTipCheckout(args), { statusCode: 409 });
  settings.tipPacks[0].flutterwavePriceNgn = 0;
  await assert.rejects(createFlutterwaveTipCheckout(args), /not available with Flutterwave/);
  assert.equal(provider.mock.calls.length, 0);
});

test('verification rejects forged callback details and requires an exact successful NGN tip', () => {
  assert.equal(validateFlutterwaveTip(purchase(), payment()), true);
  assert.equal(validateFlutterwaveTip(purchase(), { ...payment(), status: 'failed' }), false);
  for (const patch of [{ tx_ref: 'other' }, { currency: 'USD' }, { amount: 7499 }, { amount: 7501 }, { id: null }]) {
    assert.throws(() => validateFlutterwaveTip(purchase(), { ...payment(), ...patch }));
  }
});

function ledger(t, { alreadyTipped = false } = {}) {
  let state = { tx: purchase(), session: { _id: 'session', user: 'buyer', advisor: 'advisor', sessionCode: 'SES-1',
    status: 'completed', tipCount: alreadyTipped ? 1 : 0 }, earnings: 0, receipts: [], jobs: [] };
  let tail = Promise.resolve();
  let failWallet = false;
  const query = getter => ({ session: s => getter(s.state), then: resolve => Promise.resolve(getter(state)).then(resolve) });
  const apply = (object, update) => {
    for (const [field, value] of Object.entries(update.$set || {})) {
      const keys = field.split('.'); if (keys.length === 2) object[keys[0]][keys[1]] = value; else object[field] = value;
    }
    for (const [field, value] of Object.entries(update.$inc || {})) object[field] = (object[field] || 0) + value;
  };
  t.mock.method(mongoose, 'startSession', async () => {
    const s = { endSession: async () => {}, withTransaction: async work => {
      const previous = tail; let release; tail = new Promise(r => { release = r; }); await previous;
      s.state = structuredClone(state);
      try { await work(); state = s.state; } finally { release(); }
    } }; return s;
  });
  t.mock.method(Transaction, 'findOneAndUpdate', async (_, patch, options) => {
    const db = options.session.state;
    if (db.tx.status === 'completed') return null;
    apply(db.tx, patch); return structuredClone(db.tx);
  });
  t.mock.method(Transaction, 'findById', () => query(db => structuredClone(db.tx)));
  t.mock.method(Transaction, 'exists', filter => query(db => filter.flutterwaveRefundId
    ? db.receipts.some(r => r.flutterwaveRefundId === filter.flutterwaveRefundId)
    : db.session.tipCount > 0));
  t.mock.method(Transaction, 'create', async (records, options) => records.map((r, i) => {
    const saved = { ...r, _id: `receipt-${options.session.state.receipts.length}-${i}` };
    options.session.state.receipts.push(saved); return saved;
  }));
  t.mock.method(Transaction, 'updateOne', async (_, patch, options) => apply(options.session.state.tx, patch));
  t.mock.method(Session, 'findById', () => query(db => ({ ...db.session, save: async function () {
    const { save, ...fields } = this; db.session = fields;
  } })));
  t.mock.method(Session, 'updateOne', async (_, patch, options) => apply(options.session.state.session, patch));
  t.mock.method(Wallet, 'findOneAndUpdate', async (filter, patch, options) => {
    if (failWallet) throw new Error('wallet unavailable');
    assert.equal(filter.user, 'advisor'); assert.equal(patch.$inc.balance, undefined);
    options.session.state.earnings += patch.$inc.tipEarningsBalanceUsd;
    return {};
  });
  t.mock.method(Job, 'create', async (records, options) => { options.session.state.jobs.push(...records); return records; });
  return { state: () => state, failWallet: value => { failWallet = value; } };
}

test('concurrent callback/webhook deliveries award one full advisor tip, without user credits or fee deductions', async t => {
  const db = ledger(t);
  await Promise.all([fulfillFlutterwaveTip(purchase(), payment()), fulfillFlutterwaveTip(purchase(), payment())]);
  const s = db.state();
  assert.equal(s.earnings, 5);
  assert.equal(s.session.tipCount, 1);
  assert.equal(s.receipts.filter(r => r.type === 'tip_fiat').length, 1);
  assert.equal(s.receipts.filter(r => r.type === 'advisor_tip_fiat').length, 1);
  assert.equal(s.tx.metadata.providerFeeNgn, 100);
  assert.equal(advisorTipBreakdown(s.receipts.find(r => r.type === 'advisor_tip_fiat')).platform, 'flutterwave');
});

test('wallet failure rolls back the tip receipt and session, so verification can safely retry', async t => {
  const db = ledger(t); db.failWallet(true);
  await assert.rejects(fulfillFlutterwaveTip(purchase(), payment()), /wallet unavailable/);
  assert.equal(db.state().tx.status, 'pending'); assert.equal(db.state().receipts.length, 0);
  assert.equal(db.state().session.tipCount, 0);
  db.failWallet(false); await fulfillFlutterwaveTip(purchase(), payment());
  assert.equal(db.state().earnings, 5);
});

test('partial refunds are idempotent, use the frozen rate and reduce advisor earnings without touching credits', async t => {
  const db = ledger(t);
  const refund = { id: 99, transaction_id: 123, status: 'completed', amount_refunded: 3000, currency: 'NGN' };
  await applyFlutterwaveTipRefund({ tx: purchase(), payment: payment(), refund, refundId: '99' });
  await applyFlutterwaveTipRefund({ tx: db.state().tx, payment: payment(), refund, refundId: '99' });
  assert.equal(db.state().earnings, 3);
  assert.equal(db.state().session.tipNetAmountFiatUsd, 3);
  assert.equal(db.state().tx.metadata.refundedNgn, 3000);
  const final = { ...refund, id: 100, amount_refunded: 4500 };
  await applyFlutterwaveTipRefund({ tx: db.state().tx, payment: payment(), refund: final, refundId: '100' });
  assert.equal(db.state().earnings, 0);
  assert.equal(db.state().tx.metadata.refundedNgn, 7500);
  assert.equal(db.state().receipts.filter(r => r.type === 'tip_refund').length, 2);
});

test('a late payment after an IAP tip queues a full refund and never credits the advisor twice', async t => {
  const db = ledger(t, { alreadyTipped: true });
  await fulfillFlutterwaveTip(purchase(), payment());
  assert.equal(db.state().earnings, 0);
  assert.equal(db.state().tx.metadata.refundRequired, true);
  assert.equal(db.state().jobs[0].type, 'flutterwave_tip_duplicate_refund');
  const refund = { id: 99, transaction_id: 123, status: 'completed', amount_refunded: 7500 };
  await applyFlutterwaveTipRefund({ tx: db.state().tx, payment: payment(), refund, refundId: '99' });
  assert.equal(db.state().earnings, 0);
  assert.equal(db.state().receipts.filter(r => r.type === 'advisor_tip_refund').length, 0);
});

test('tip status is buyer-scoped and rejects an invalid provider transaction ID', async t => {
  t.mock.method(Transaction, 'findOne', filter => {
    assert.equal(filter.user, 'buyer'); return { select: async () => purchase() };
  });
  await assert.rejects(new Promise((resolve, reject) => tipStatus({ user: { _id: 'buyer' },
    query: { txId: new mongoose.Types.ObjectId().toString(), transactionId: '../invalid' } }, {}, reject)), { statusCode: 400 });
});

test('the duplicate-refund job refunds the verified payment once and reconciles its receipt', async t => {
  env(t); const db = ledger(t, { alreadyTipped: true });
  await fulfillFlutterwaveTip(purchase(), payment());
  let posts = 0;
  const refund = { id: 99, transaction_id: 123, status: 'completed', amount_refunded: 7500 };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    let data;
    if (url.includes('/refunds?')) data = [];
    else if (url.endsWith('/transactions/123/verify')) data = payment();
    else if (options.method === 'POST') {
      posts++; assert.equal(JSON.parse(options.body).amount, 7500); data = refund;
    } else data = refund;
    return { ok: true, json: async () => ({ status: 'success', data }) };
  });
  await refundDuplicateFlutterwaveTip({ txId: 'checkout' });
  await refundDuplicateFlutterwaveTip({ txId: 'checkout' });
  assert.equal(posts, 1);
  assert.equal(db.state().tx.metadata.refundedNgn, 7500);
  assert.equal(db.state().earnings, 0);
});

test('a refund already initiated before a timeout is checked, never requested again', async t => {
  env(t); const db = ledger(t, { alreadyTipped: true });
  await fulfillFlutterwaveTip(purchase(), payment());
  let status = 'pending';
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'POST') posts++;
    const refund = { id: 99, transaction_id: 123, status, amount_refunded: 7500 };
    const data = url.includes('/refunds?') ? [refund] : url.endsWith('/verify') ? payment() : refund;
    return { ok: true, json: async () => ({ status: 'success', data }) };
  });
  await assert.rejects(refundDuplicateFlutterwaveTip({ txId: 'checkout' }), /Waiting for duplicate tip refund/);
  status = 'completed';
  await refundDuplicateFlutterwaveTip({ txId: 'checkout' });
  assert.equal(posts, 0);
  assert.equal(db.state().tx.metadata.refundedNgn, 7500);
});

test('the shared authenticated webhook dispatches tips, and the return page reports a tip rather than credits', async t => {
  env(t); const db = ledger(t);
  t.mock.method(Transaction, 'findOne', async () => db.state().tx);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ status: 'success', data: payment() }) }));
  const response = { status(code) { this.code = code; return this; }, json() { return this; } };
  await flutterwaveWebhook({ get: () => 'secret', body: { event: 'charge.completed', data: { id: 123, tx_ref: 'PP-TIP-ref' } } }, response);
  assert.equal(response.code, 200); assert.equal(db.state().earnings, 5);
  const html = await new Promise((resolve, reject) => flutterwaveReturn({ query: { tx_ref: 'PP-TIP-ref' } },
    { type() { return this; }, send: resolve }, reject));
  assert.match(html, /Your tip has been sent/); assert.doesNotMatch(html, /credits have been added/);
});
