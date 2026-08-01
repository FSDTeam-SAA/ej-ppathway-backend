import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyRevenueCatTipPurchase } from '../services/iapTip.service.js';

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
