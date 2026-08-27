import assert from 'node:assert/strict';
import test from 'node:test';

import { allocatePayout } from '../services/payout.service.js';

const cfg = { payoutCreditUsdRate: 1 };

test('allocates USD tips without converting them to credits', () => {
  const allocation = allocatePayout(
    { earningsBalance: 100, tipEarningsBalanceUsd: 7 },
    5,
    cfg
  );

  assert.deepEqual(allocation, { credits: 0, tipUsd: 5, amountUsd: 5 });
});

test('keeps service credits and tip USD as separate payout sources', () => {
  const allocation = allocatePayout(
    { earningsBalance: 100, tipEarningsBalanceUsd: 7 },
    10,
    cfg
  );

  assert.deepEqual(allocation, { credits: 3, tipUsd: 7, amountUsd: 10 });
});

test('a refunded-tip debt reduces the advisor USD available for payout', () => {
  const allocation = allocatePayout(
    { earningsBalance: 100, tipEarningsBalanceUsd: -5 },
    96,
    cfg
  );

  assert.equal(allocation, null);
  assert.deepEqual(
    allocatePayout(
      { earningsBalance: 100, tipEarningsBalanceUsd: -5 },
      95,
      cfg
    ),
    { credits: 95, tipUsd: 0, amountUsd: 95 }
  );
});
