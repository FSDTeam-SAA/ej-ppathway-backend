import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CREDIT_PACKS } from '../models/platformSetting.model.js';

test('default credit products include the App Store 25-credit tier', () => {
  assert.deepEqual(
    DEFAULT_CREDIT_PACKS.map((pack) => pack.revenueCatProductId),
    ['credits_25', 'credits_50', 'credits_100', 'credits_200']
  );
  assert.deepEqual(
    DEFAULT_CREDIT_PACKS.find((pack) => pack.revenueCatProductId === 'credits_25'),
    {
      id: 'credits_25',
      label: '25 Credits',
      credits: 25,
      bonusCredits: 0,
      priceUsd: 19,
      revenueCatProductId: 'credits_25',
      isActive: true,
      sortOrder: 1
    }
  );
});
