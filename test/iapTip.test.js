import assert from 'node:assert/strict';
import test from 'node:test';

import {
  lookupRevenueCatPurchase,
  revenueBreakdown,
  verifyRevenueCatTipPurchase
} from '../services/iapTip.service.js';

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
        customer_id: 'user-10',
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
      platform: 'android'
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
        platform: 'ios'
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
