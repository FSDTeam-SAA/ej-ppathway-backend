import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import PlatformSetting from '../models/platformSetting.model.js';
import Currency from '../models/currency.model.js';
import Job from '../models/job.model.js';
import Transaction from '../models/transaction.model.js';
import Wallet from '../models/wallet.model.js';
import { applyFlutterwaveCreditRefund, cancelFlutterwaveCheckout, createFlutterwaveCreditCheckout, flutterwaveSecretMatches, isAllowedFlutterwaveCheckoutUrl,
  fulfillFlutterwaveCredits, validateFlutterwavePayment } from '../services/flutterwave.service.js';
import { flutterwaveWebhook, flutterwaveStatus } from '../controllers/flutterwave.controller.js';
import { chargeUserWallet } from '../services/session.service.js';
import { transactionDisplay } from '../utils/transactionReporting.js';

const purchase = () => ({ _id: 'purchase', user: 'buyer', provider: 'flutterwave',
  type: 'credit_pack_purchase', status: 'pending', currency: 'ngn', amount: 35000,
  amountUsd: 35, flutterwaveReference: 'PP-CREDITS-ref',
  metadata: { packId: 'credits_50', credits: 50, bonusCredits: 5, totalCredits: 55, ngnPerUsd: 1000 } });
const payment = () => ({ id: 123, status: 'successful', tx_ref: 'PP-CREDITS-ref',
  amount: 35000, currency: 'NGN', app_fee: 500, payment_type: 'card' });

test('checkout URL validation accepts the real sandbox host only in test mode', () => {
  const sandbox = 'https://checkout-v2.dev-flutterwave.com/v3/hosted/pay/fixture';
  assert.equal(isAllowedFlutterwaveCheckoutUrl(sandbox, { testMode: true }), true);
  assert.equal(isAllowedFlutterwaveCheckoutUrl(sandbox, { testMode: false }), false);
  assert.equal(isAllowedFlutterwaveCheckoutUrl('https://checkout.flutterwave.com/v3/hosted/pay/fixture', { testMode: false }), true);
  for (const url of ['http://checkout-v2.dev-flutterwave.com/pay',
    'https://checkout-v2.dev-flutterwave.com.evil.test/pay', 'https://evil.dev-flutterwave.com/pay',
    'https://checkout.flutterwave.com.evil.test/pay', 'https://user:pass@checkout.flutterwave.com/pay',
    'https://checkout.flutterwave.com:444/pay']) {
    assert.equal(isAllowedFlutterwaveCheckoutUrl(url, { testMode: true }), false);
  }
});

function env(t) {
  for (const [name, value] of Object.entries({ FLUTTERWAVE_ENABLED: 'true',
    FLUTTERWAVE_SECRET_KEY: 'FLWSECK_TEST-fixture', FLUTTERWAVE_WEBHOOK_SECRET: 'fixture-secret',
    SERVER_URL: 'https://api.example.test' })) {
    const old = process.env[name]; process.env[name] = value;
    t.after(() => old === undefined ? delete process.env[name] : process.env[name] = old);
  }
}

test('credits require a successful exact NGN payment for the generated reference', () => {
  assert.equal(validateFlutterwavePayment(purchase(), payment()), true);
  assert.equal(validateFlutterwavePayment(purchase(), { ...payment(), status: 'failed' }), false);
  for (const change of [{ tx_ref: 'another-user-reference' }, { amount: 34999.99 },
    { amount: 35001 }, { currency: 'USD' }, { id: null }, { amount: 'NaN' }]) {
    assert.throws(() => validateFlutterwavePayment(purchase(), { ...payment(), ...change }));
  }
});

test('checkout freezes admin Naira price, bonus and USD reporting rate; a retried request reuses its receipt', async (t) => {
  env(t);
  const originalDb = mongoose.connection.db;
  mongoose.connection.db = { admin: () => ({ command: async () => ({ setName: 'fixture' }) }) };
  t.after(() => { mongoose.connection.db = originalDb; });
  t.mock.method(Transaction, 'init', async () => Transaction);
  const pack = { id: 'credits_50', label: '50 Credits', credits: 50, bonusCredits: 5,
    priceUsd: 35, flutterwavePriceNgn: 42000, isActive: true };
  t.mock.method(PlatformSetting, 'findOne', async () => ({ creditPacks: [pack], creditPackCatalogVersion: 2, tierThresholds: {} }));
  t.mock.method(Currency, 'findOne', () => ({ lean: async () => ({ usdRate: 1200 }) }));
  let stored;
  t.mock.method(Transaction, 'findOne', () => ({ select: async () => stored }));
  t.mock.method(Transaction, 'create', async (data) => { stored = { ...data, _id: 'receipt', save: async () => {} }; return stored; });
  const queued = [];
  t.mock.method(Job, 'create', async (job) => { queued.push(job); return job; });
  let apiCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    apiCalls++;
    assert.equal(url, 'https://api.flutterwave.com/v3/payments');
    const body = JSON.parse(options.body);
    assert.equal(body.amount, 42000);
    assert.equal(body.currency, 'NGN');
    assert.equal(body.redirect_url, 'https://api.example.test/api/v1/wallet/flutterwave/return');
    return { ok: true, json: async () => ({ status: 'success', data: { link: 'https://checkout-v2.dev-flutterwave.com/v3/hosted/pay/fixture' } }) };
  });
  const request = { user: { _id: 'buyer', email: 'test@example.test', name: 'Buyer', country: 'GB' },
    packId: pack.id, expectedAmountNgn: 42000, requestId: 'request_1234567890' };
  const result = await createFlutterwaveCreditCheckout(request);
  assert.equal(result.amountUsd, 35);
  assert.equal(result.country, 'GB'); // Currency does not replace customer country.
  assert.equal(result.metadata.totalCredits, 55);
  assert.equal(result.metadata.ngnPerUsd, 1200);
  assert.equal(result.metadata.isTest, true);
  assert.match(result.flutterwaveCheckoutUrl, /^https:\/\/checkout-v2\.dev-flutterwave\.com\//);
  assert.equal(queued[0].type, 'flutterwave_credit_reconcile');
  pack.credits = 500; pack.flutterwavePriceNgn = 99999;
  const retry = await createFlutterwaveCreditCheckout(request);
  assert.equal(retry.metadata.totalCredits, 55);
  assert.equal(retry.amount, 42000);
  assert.equal(apiCalls, 1);
});

test('a stale displayed price cannot start a different-priced payment', async (t) => {
  env(t);
  t.mock.method(Transaction, 'findOne', () => ({ select: async () => null }));
  t.mock.method(PlatformSetting, 'findOne', async () => ({ creditPacks: [{ id: 'pack', credits: 50,
    flutterwavePriceNgn: 50000 }], creditPackCatalogVersion: 2, tierThresholds: {} }));
  const create = t.mock.method(Transaction, 'create', async () => { throw new Error('must not create'); });
  await assert.rejects(createFlutterwaveCreditCheckout({ user: { _id: 'buyer' },
    packId: 'pack', expectedAmountNgn: 100, requestId: 'request_1234567890' }), /price changed/);
  assert.equal(create.mock.calls.length, 0);
});

test('cancellation disables the hosted link and cannot overwrite a payment completed concurrently', async (t) => {
  env(t);
  const tx = { ...purchase(), flutterwaveCheckoutUrl: 'https://checkout.flutterwave.com/v3/hosted/pay/fixture' };
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    urls.push(url);
    if (url.endsWith('/payments/link/disable')) assert.equal(JSON.parse(options.body).link, tx.flutterwaveCheckoutUrl);
    return { ok: true, json: async () => ({ status: 'success', data:
      url.endsWith('/payments/link/disable') ? true : { ...payment(), status: 'pending' } }) };
  });
  t.mock.method(Transaction, 'findOneAndUpdate', async (filter) => {
    assert.equal(filter.status, 'pending');
    return null; // payment completed while the disable request was in flight
  });
  t.mock.method(Transaction, 'findById', async () => ({ ...tx, status: 'completed' }));
  const result = await cancelFlutterwaveCheckout(tx);
  assert.equal(result.status, 'completed');
  assert.equal(urls.length, 2);
});

// Transactional persistence double, including rollback and serialized concurrent
// commits. Tests below exercise the actual fulfillment service with failures.
function ledger(t) {
  let state = { tx: purchase(), balance: 10, refunds: [] };
  let lock = Promise.resolve();
  let failWallet = false;
  t.mock.method(mongoose, 'startSession', async () => {
    const session = { endSession: async () => {}, withTransaction: async (work) => {
      const previous = lock; let release;
      lock = new Promise((resolve) => { release = resolve; });
      await previous;
      session.state = structuredClone(state);
      try { await work(); state = session.state; } finally { release(); }
    } };
    return session;
  });
  t.mock.method(Transaction, 'findOneAndUpdate', async (_filter, update, options) => {
    const db = options.session.state;
    if (db.tx.status === 'completed') return null;
    db.tx.status = update.$set.status;
    db.tx.flutterwaveTransactionId = update.$set.flutterwaveTransactionId;
    return structuredClone(db.tx);
  });
  t.mock.method(Transaction, 'findById', () => ({ session: async (s) => structuredClone(s.state.tx) }));
  t.mock.method(Transaction, 'findOne', (filter) => {
    if (filter.flutterwaveRefundId) return { session: async (s) => s.state.refunds.find((r) => r.flutterwaveRefundId === filter.flutterwaveRefundId) };
    return Promise.resolve(structuredClone(state.tx));
  });
  t.mock.method(Wallet, 'findOneAndUpdate', async (_filter, update, options) => {
    if (failWallet) { failWallet = false; throw new Error('database write failed'); }
    options.session.state.balance += update.$inc.balance;
    return { balance: options.session.state.balance };
  });
  t.mock.method(Wallet, 'updateOne', async (_filter, update, options) => { options.session.state.balance += update.$inc.balance; });
  t.mock.method(Transaction, 'create', async (docs, options) => { options.session.state.refunds.push(...docs); return docs; });
  t.mock.method(Transaction, 'updateOne', async (_filter, update, options) => {
    for (const [name, value] of Object.entries(update.$set)) options.session.state.tx.metadata[name.replace('metadata.', '')] = value;
  });
  return { state: () => state, failWallet: () => { failWallet = true; } };
}

test('duplicate callbacks and concurrent webhook deliveries add a pack exactly once', async (t) => {
  const db = ledger(t);
  await Promise.all(Array.from({ length: 12 }, () => fulfillFlutterwaveCredits(purchase(), payment())));
  assert.equal(db.state().balance, 65);
  assert.equal(db.state().tx.status, 'completed');
  assert.equal(db.state().tx.flutterwaveTransactionId, '123');
});

test('a wallet write failure rolls back the receipt so retry can credit it', async (t) => {
  const db = ledger(t); db.failWallet();
  await assert.rejects(fulfillFlutterwaveCredits(purchase(), payment()), /database write failed/);
  assert.equal(db.state().balance, 10);
  assert.equal(db.state().tx.status, 'pending');
  await fulfillFlutterwaveCredits(purchase(), payment());
  assert.equal(db.state().balance, 65);
});

test('verified partial refunds, repeated deliveries and out-of-order payment webhooks preserve both ledgers', async (t) => {
  env(t); const db = ledger(t);
  t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, json: async () => ({ status: 'success',
    data: url.includes('/refunds/') ? { id: url.split('/').at(-1), transaction_id: 123,
      amount_refunded: 17500, status: 'completed' } : payment() }) }));
  // First refund also fulfills a payment whose charge webhook has not arrived.
  await applyFlutterwaveCreditRefund('refund-one');
  await applyFlutterwaveCreditRefund('refund-one');
  assert.equal(db.state().refunds.length, 1);
  assert.equal(db.state().balance, 37); // 10 + 55 - round(55/2)
  await applyFlutterwaveCreditRefund('refund-two');
  await fulfillFlutterwaveCredits(purchase(), payment());
  assert.equal(db.state().balance, 10);
  assert.equal(db.state().refunds.length, 2);
  assert.equal(db.state().refunds.reduce((sum, r) => sum + r.amountUsd, 0), 35);
  assert.equal(db.state().refunds.reduce((sum, r) => sum + r.metadata.totalCredits, 0), 55);
});

test('a purchase arriving during a session charge is not overwritten', async (t) => {
  let wallet = { _id: 'wallet', balance: 50, freeCredits: 5, totalSpent: 0 };
  t.mock.method(Wallet, 'findOne', async () => ({ ...wallet }));
  let attempts = 0;
  t.mock.method(Wallet, 'findOneAndUpdate', async (filter, update) => {
    if (attempts++ === 0) wallet.balance += 50; // checkout completes after the read
    if (filter.balance !== wallet.balance || filter.freeCredits !== wallet.freeCredits) return null;
    for (const [name, value] of Object.entries(update.$inc)) wallet[name] += value;
    return { ...wallet };
  });
  assert.deepEqual(await chargeUserWallet({ userId: 'buyer', amount: 15 }), { creditsUsed: 5, balanceUsed: 10 });
  assert.equal(wallet.balance, 90);
  assert.equal(wallet.totalSpent, 15);
});

test('webhooks reject an invalid secret; database failures ask Flutterwave to retry', async (t) => {
  env(t);
  assert.equal(flutterwaveSecretMatches('fixture-secret'), true);
  assert.equal(flutterwaveSecretMatches('bad'), false);
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await flutterwaveWebhook({ get: () => 'bad' }, res);
  assert.equal(res.code, 401);
  t.mock.method(Transaction, 'findOne', async () => { throw new Error('database unavailable'); });
  t.mock.method(console, 'error', () => {});
  await flutterwaveWebhook({ get: () => 'fixture-secret', body: { event: 'charge.completed', data: { id: 123, tx_ref: 'ref' } } }, res);
  assert.equal(res.code, 503);
});

test('status lookup is scoped to the signed-in buyer; NGN revenue is displayed in NGN', async (t) => {
  const id = new mongoose.Types.ObjectId().toString();
  t.mock.method(Transaction, 'findOne', async (filter) => {
    assert.equal(filter.user, 'signed-in-buyer'); assert.equal(filter._id, id);
    return null;
  });
  await new Promise((resolve, reject) => {
    flutterwaveStatus({ query: { txId: id }, user: { _id: 'signed-in-buyer' } }, {}, (error) => {
      try { assert.equal(error.statusCode, 404); resolve(); } catch (e) { reject(e); }
    });
  });
  assert.deepEqual(transactionDisplay(purchase()), { displayAmount: 35000, displayUnit: 'NGN' });
});

test('the app return verifies its transaction ID and duplicate checks credit the wallet only once', async (t) => {
  env(t);
  const db = ledger(t);
  const id = new mongoose.Types.ObjectId().toString();
  t.mock.method(Wallet, 'findOne', async () => ({ balance: db.state().balance }));
  const provider = t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, 'https://api.flutterwave.com/v3/transactions/123/verify');
    return { ok: true, json: async () => ({ status: 'success', data: payment() }) };
  });
  const check = () => new Promise((resolve, reject) => {
    const res = { status() { return this; }, json: resolve };
    flutterwaveStatus({ query: { txId: id, transactionId: '123' }, user: { _id: 'buyer' } }, res, reject);
  });
  const first = await check();
  const second = await check();
  assert.equal(first.data.status, 'completed');
  assert.equal(first.data.reference, 'PP-CREDITS-ref');
  assert.equal(second.data.walletBalance, 65);
  assert.equal(db.state().balance, 65);
  assert.equal(provider.mock.calls.length, 1);
});

test('a callback transaction belonging to another reference cannot fulfill the buyer purchase', async (t) => {
  env(t);
  const db = ledger(t);
  const id = new mongoose.Types.ObjectId().toString();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({
    status: 'success', data: { ...payment(), tx_ref: 'another-reference' }
  }) }));
  await assert.rejects(new Promise((resolve, reject) => {
    const res = { status() { return this; }, json: resolve };
    flutterwaveStatus({ query: { txId: id, transactionId: '123', status: 'successful' },
      user: { _id: 'buyer' } }, res, reject);
  }), /does not match this credit purchase/i);
  assert.equal(db.state().balance, 10);
  assert.equal(db.state().tx.status, 'pending');
});

test('status rejects non-numeric callback transaction IDs without calling the provider', async (t) => {
  env(t);
  t.mock.method(Transaction, 'findOne', async () => purchase());
  const provider = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not call'); });
  await new Promise((resolve, reject) => {
    flutterwaveStatus({ query: { txId: new mongoose.Types.ObjectId().toString(), transactionId: '../bad' },
      user: { _id: 'buyer' } }, {}, (error) => {
      try { assert.equal(error.statusCode, 400); resolve(); } catch (e) { reject(e); }
    });
  });
  assert.equal(provider.mock.calls.length, 0);
});
