import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateSessionCredits,
  resolveAdvisorCreditPricing
} from '../services/credit.service.js';

const globalPricing = {
  chatPerMin: 1,
  callPerMin: 2,
  videoPerMin: 3
};

test('uses global advisor pricing when an advisor has no admin override', () => {
  const pricing = resolveAdvisorCreditPricing(
    {
      pricingOverrideEnabled: false,
      pricing: { chatPerMin: 9, callPerMin: 9, videoPerMin: 9 }
    },
    globalPricing
  );

  assert.deepEqual(pricing, globalPricing);
});

test('uses advisor-specific pricing when an admin override is enabled', () => {
  const pricing = resolveAdvisorCreditPricing(
    {
      pricingOverrideEnabled: true,
      pricing: { chatPerMin: 4, callPerMin: 5.5, videoPerMin: 7 }
    },
    globalPricing
  );

  assert.deepEqual(pricing, { chatPerMin: 4, callPerMin: 5.5, videoPerMin: 7 });
});

test('falls back per field when stored override data is invalid', () => {
  const pricing = resolveAdvisorCreditPricing(
    {
      pricingOverrideEnabled: true,
      pricing: { chatPerMin: -1, callPerMin: 'bad', videoPerMin: 0 }
    },
    globalPricing
  );

  assert.deepEqual(pricing, { chatPerMin: 1, callPerMin: 2, videoPerMin: 0 });
});

test('charges an advisor override per minute instead of using a fixed global usage block', async () => {
  const result = await calculateSessionCredits({
    profile: {
      pricingOverrideEnabled: true,
      pricing: { chatPerMin: 2.5, callPerMin: 4, videoPerMin: 6 }
    },
    type: 'chat',
    durationMinutes: 15
  });

  assert.deepEqual(result, { ratePerMin: 2.5, credits: 38 });
});
