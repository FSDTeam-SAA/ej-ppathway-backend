import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CREDIT_PACKS } from '../models/platformSetting.model.js';

test('default credit products exclude the retired tier', () => {
  assert.deepEqual(
    DEFAULT_CREDIT_PACKS.map((pack) => pack.revenueCatProductId),
    ['credits_50', 'credits_100', 'credits_200']
  );
  assert.equal(DEFAULT_CREDIT_PACKS.some((pack) => pack.credits === 25), false);
});
