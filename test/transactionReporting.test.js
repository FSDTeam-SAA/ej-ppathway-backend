import test from 'node:test';
import assert from 'node:assert/strict';
import { transactionDisplay, REVENUE_TYPES } from '../utils/transactionReporting.js';

test('session and recording credits are not formatted as dollars', () => {
  for (const type of ['session_charge', 'session_refund', 'unlock_recording', 'unlock_transcript']) {
    assert.deepEqual(transactionDisplay({ type, amount: 20, currency: 'usd' }), { displayAmount: 20, displayUnit: 'credits' });
    assert.equal(REVENUE_TYPES.includes(type), false);
  }
});
test('store purchase and advisor payout use their own monetary units', () => {
  assert.deepEqual(transactionDisplay({ type: 'credit_pack_purchase', amount: 35, currency: 'gbp', amountUsd: 40 }), { displayAmount: 35, displayUnit: 'GBP' });
  assert.deepEqual(transactionDisplay({ type: 'advisor_tip_fiat', amount: 10, amountUsd: 10, netProceedsUsd: 7 }), { displayAmount: 7, displayUnit: 'USD' });
  assert.deepEqual(transactionDisplay({ type: 'advisor_payout', amount: 20, amountUsd: 25 }), { displayAmount: 25, displayUnit: 'USD' });
});
