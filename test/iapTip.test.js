import assert from 'node:assert/strict';
import test from 'node:test';

import {
  lookupRevenueCatPurchase,
  revenueBreakdown,
  verifyRevenueCatTipPurchase
} from '../services/iapTip.service.js';
import Transaction from '../models/transaction.model.js';

test('missing proceeds are unknown, never interpreted as zero net earnings', () => {
  const revenue = revenueBreakdown({ revenue_in_usd: { gross: 10, proceeds: null } }, ['revenue_in_usd']);
  assert.equal(revenue.proceeds, null);
  assert.equal(revenue.commission, null);
});

test('enforces one initiating IAP tip per session', () => {
  const tipIndex = Transaction.schema.indexes().find(
    ([, options]) => options.name === 'unique_iap_tip_per_session'
  );

  assert.ok(tipIndex);
  assert.equal(tipIndex[1].unique, true);
  assert.deepEqual(tipIndex[1].partialFilterExpression, { type: 'tip_fiat' });
});

test('uses RevenueCat proceeds instead of gross revenue for advisor tips', () => {
  const revenue = revenueBreakdown(
    {
      revenue_in_usd: {
        currency: 'USD',
        gross: 10,
        commission: 3,
        tax: 0.5,
        proceeds: 6.5
      }
    },
    ['revenue_in_usd']
  );

  assert.deepEqual(revenue, {
    currency: 'usd',
    gross: 10,
    commission: 3,
    tax: 0.5,
    proceeds: 6.5
  });
});

test('retries a RevenueCat purchase lookup when the transaction is not visible yet', async () => {
  let calls = 0;
  const purchase = await lookupRevenueCatPurchase({
    url: new URL('https://api.revenuecat.com/v2/projects/test/purchases'),
    apiKey: 'test-secret-key',
    delaysMs: [0, 0],
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () =>
          calls === 1
            ? { items: [] }
            : { items: [{ id: 'purchase-1', product_store_identifier: 'tip_10' }] }
      };
    }
  });

  assert.equal(calls, 2);
  assert.equal(purchase.id, 'purchase-1');
});

test('verified tips return local purchase details and net USD proceeds', async () => {
  const previous = {
    secretApiKey: process.env.REVENUECAT_SECRET_API_KEY,
    projectId: process.env.REVENUECAT_PROJECT_ID,
    allowUnverified: process.env.IAP_TIP_ALLOW_UNVERIFIED,
    fetch: globalThis.fetch
  };
  process.env.REVENUECAT_SECRET_API_KEY = 'test-secret';
  process.env.REVENUECAT_PROJECT_ID = 'test-project';
  process.env.IAP_TIP_ALLOW_UNVERIFIED = 'false';
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      items: [{
        id: 'purchase-10',
        app_user_id: 'user-10',
        product_store_identifier: 'tip_10',
        store: 'play_store',
        revenue_in_local_currency: {
          currency: 'BDT',
          gross: 1200,
          commission: 180,
          tax: 20,
          proceeds: 1000
        },
        revenue_in_usd: {
          currency: 'USD',
          gross: 10,
          commission: 1.5,
          tax: 0.25,
          proceeds: 8.25
        }
      }]
    })
  });

  try {
    const verified = await verifyRevenueCatTipPurchase({
      productId: 'tip_10',
      storeTransactionId: 'store-10',
      appUserId: 'user-10',
      platform: 'android',
      receiptLookup: async () => null
    });

    assert.equal(verified.currency, 'bdt');
    assert.equal(verified.localGrossAmount, 1200);
    assert.equal(verified.localNetProceeds, 1000);
    assert.equal(verified.grossAmountUsd, 10);
    assert.equal(verified.netProceedsUsd, 8.25);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of Object.entries({
      REVENUECAT_SECRET_API_KEY: previous.secretApiKey,
      REVENUECAT_PROJECT_ID: previous.projectId,
      IAP_TIP_ALLOW_UNVERIFIED: previous.allowUnverified
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('resolves RevenueCat v2 internal product and customer IDs before verifying a tip', async () => {
  const previous = {
    secretApiKey: process.env.REVENUECAT_SECRET_API_KEY,
    projectId: process.env.REVENUECAT_PROJECT_ID,
    allowUnverified: process.env.IAP_TIP_ALLOW_UNVERIFIED,
    fetch: globalThis.fetch
  };
  process.env.REVENUECAT_SECRET_API_KEY = 'test-secret';
  process.env.REVENUECAT_PROJECT_ID = 'test-project';
  process.env.IAP_TIP_ALLOW_UNVERIFIED = 'false';

  const requestedPaths = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    requestedPaths.push(parsed.pathname);
    if (parsed.pathname.endsWith('/purchases')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [{
            id: 'purchase-v2',
            customer_id: 'cust_rc_internal',
            product_id: 'prod_rc_internal',
            store: 'app_store',
            revenue_in_local_currency: {
              currency: 'GBP',
              gross: 5,
              commission: 1.5,
              tax: 0,
              proceeds: 3.5
            },
            revenue_in_usd: {
              currency: 'USD',
              gross: 6.5,
              commission: 1.95,
              tax: 0,
              proceeds: 4.55
            }
          }]
        })
      };
    }
    if (parsed.pathname.endsWith('/products/prod_rc_internal')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'prod_rc_internal', store_identifier: 'tip_5' })
      };
    }
    if (parsed.pathname.endsWith('/customers/cust_rc_internal/aliases')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [{ id: 'mongo-user-5' }, { id: '$RCAnonymous:old' }] })
      };
    }
    throw new Error(`Unexpected RevenueCat URL: ${url}`);
  };

  try {
    const verified = await verifyRevenueCatTipPurchase({
      productId: 'tip_5',
      storeTransactionId: 'apple-transaction-5',
      appUserId: 'mongo-user-5',
      platform: 'ios',
      receiptLookup: async () => null
    });

    assert.equal(verified.productId, 'tip_5');
    assert.equal(verified.netProceedsUsd, 4.55);
    assert.deepEqual(requestedPaths, [
      '/v2/projects/test-project/purchases',
      '/v2/projects/test-project/products/prod_rc_internal',
      '/v2/projects/test-project/customers/cust_rc_internal/aliases'
    ]);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of Object.entries({
      REVENUECAT_SECRET_API_KEY: previous.secretApiKey,
      REVENUECAT_PROJECT_ID: previous.projectId,
      IAP_TIP_ALLOW_UNVERIFIED: previous.allowUnverified
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('uses an authenticated webhook receipt when RevenueCat purchase search is not yet available', async () => {
  const previous = {
    secretApiKey: process.env.REVENUECAT_SECRET_API_KEY,
    projectId: process.env.REVENUECAT_PROJECT_ID,
    allowUnverified: process.env.IAP_TIP_ALLOW_UNVERIFIED
  };
  process.env.REVENUECAT_SECRET_API_KEY = 'test-secret';
  process.env.REVENUECAT_PROJECT_ID = 'test-project';
  process.env.IAP_TIP_ALLOW_UNVERIFIED = 'false';

  try {
    const verified = await verifyRevenueCatTipPurchase({
      productId: 'tip_20',
      storeTransactionId: 'apple-original-20',
      appUserId: 'mongo-user-20',
      platform: 'ios',
      receiptLookup: async () => ({
        eventId: 'rc-event-20',
        productId: 'tip_20',
        transactionId: 'apple-transaction-20',
        originalTransactionId: 'apple-original-20',
        appUserId: '$RCAnonymous:old',
        aliases: ['mongo-user-20'],
        store: 'APP_STORE',
        currency: 'GBP',
        priceInPurchasedCurrency: 20,
        priceUsd: 25,
        commissionPercentage: 0.3,
        taxPercentage: 0,
        refunded: false
      })
    });

    assert.equal(verified.storeTransactionId, 'apple-transaction-20');
    assert.equal(verified.localNetProceeds, 14);
    assert.equal(verified.netProceedsUsd, 17.5);
  } finally {
    for (const [key, value] of Object.entries({
      REVENUECAT_SECRET_API_KEY: previous.secretApiKey,
      REVENUECAT_PROJECT_ID: previous.projectId,
      IAP_TIP_ALLOW_UNVERIFIED: previous.allowUnverified
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('accepts fixed tip tiers and derives USD from the product ID in development', async () => {
  const previous = {
    allowUnverified: process.env.IAP_TIP_ALLOW_UNVERIFIED,
    apiKey: process.env.REVENUECAT_API_KEY,
    secretApiKey: process.env.REVENUECAT_SECRET_API_KEY,
    v2ApiKey: process.env.REVENUECAT_V2_API_KEY,
    projectId: process.env.REVENUECAT_PROJECT_ID,
    productIds: process.env.IAP_TIP_PRODUCT_IDS
  };

  process.env.IAP_TIP_ALLOW_UNVERIFIED = 'true';
  process.env.REVENUECAT_API_KEY = '';
  process.env.REVENUECAT_SECRET_API_KEY = '';
  process.env.REVENUECAT_V2_API_KEY = '';
  process.env.REVENUECAT_PROJECT_ID = '';
  delete process.env.IAP_TIP_PRODUCT_IDS;

  try {
    const verified = await verifyRevenueCatTipPurchase({
      productId: 'tip_20',
      storeTransactionId: 'test-transaction',
      fallbackAmount: 2200,
      fallbackCurrency: 'bdt',
      fallbackAmountUsd: 999,
      platform: 'ios'
    });

    assert.equal(verified.verified, false);
    assert.equal(verified.amount, 2200);
    assert.equal(verified.currency, 'bdt');
    assert.equal(verified.amountUsd, 20);
    assert.equal(verified.netProceedsUsd, 20);

    await assert.rejects(
      verifyRevenueCatTipPurchase({
        productId: 'tip_1',
        storeTransactionId: 'forged-transaction',
        fallbackAmount: 1,
        fallbackCurrency: 'usd',
        fallbackAmountUsd: 1,
        platform: 'ios',
        receiptLookup: async () => null
      }),
      /Unknown tip product/
    );
  } finally {
    for (const [key, value] of Object.entries({
      IAP_TIP_ALLOW_UNVERIFIED: previous.allowUnverified,
      REVENUECAT_API_KEY: previous.apiKey,
      REVENUECAT_SECRET_API_KEY: previous.secretApiKey,
      REVENUECAT_V2_API_KEY: previous.v2ApiKey,
      REVENUECAT_PROJECT_ID: previous.projectId,
      IAP_TIP_PRODUCT_IDS: previous.productIds
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
