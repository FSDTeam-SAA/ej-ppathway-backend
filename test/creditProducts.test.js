import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CREDIT_PACKS } from '../models/platformSetting.model.js';

test('default credit products contain only the selected 50 and 100 credit tiers', () => {
  assert.deepEqual(
    DEFAULT_CREDIT_PACKS.map((pack) => pack.revenueCatProductId),
    ['credits_50', 'credits_100']
  );
  assert.deepEqual(
    DEFAULT_CREDIT_PACKS.find((pack) => pack.revenueCatProductId === 'credits_50'),
    {
      id: 'credits_50',
      label: '50 Credits',
      credits: 50,
      bonusCredits: 0,
      priceUsd: 35,
      revenueCatProductId: 'credits_50',
      appleProductId: 'credits_50',
      googleProductId: 'credits_50',
      isActive: true,
      sortOrder: 1
    }
  );
});
