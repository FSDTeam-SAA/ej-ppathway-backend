import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADVISOR_TIP_TYPES,
  advisorTipBreakdown,
  normalizeTipBreakdownSummary,
  advisorTipDisplayAmountUsd
} from '../utils/advisorTip.js';

test('advisor tip filters include legacy and fiat transactions', () => {
  assert.deepEqual(ADVISOR_TIP_TYPES, ['advisor_tip', 'advisor_tip_fiat']);
});

test('legacy tip amount uses the migration USD conversion rate', () => {
  assert.equal(
    advisorTipDisplayAmountUsd({
      type: 'advisor_tip',
      amount: 10,
      metadata: { tipBalanceSplitRateUsd: 0.5 }
    }),
    5
  );
});

test('fiat tip amount prefers net proceeds', () => {
  assert.equal(
    advisorTipDisplayAmountUsd({
      type: 'advisor_tip_fiat',
      amount: 10,
      amountUsd: 9,
      netProceedsUsd: 7.25
    }),
    7.25
  );
});

test('store tip breakdown reports actual deductions and percentage', () => {
  assert.deepEqual(
    advisorTipBreakdown({
      type: 'advisor_tip_fiat',
      iapPlatform: 'app_store',
      grossAmountUsd: 10,
      commissionAmountUsd: 1.5,
      taxAmountUsd: 0.5,
      netProceedsUsd: 8
    }),
    {
      platform: 'app_store',
      grossUsd: 10,
      commissionUsd: 1.5,
      taxUsd: 0.5,
      deductionsUsd: 2,
      deductionPercent: 20,
      netUsd: 8
    }
  );
});

test('legacy tip breakdown is marked direct with no store deduction', () => {
  assert.deepEqual(
    advisorTipBreakdown({
      type: 'advisor_tip',
      amount: 10,
      metadata: { tipBalanceSplitRateUsd: 1 }
    }),
    {
      platform: 'direct',
      grossUsd: 10,
      commissionUsd: 0,
      taxUsd: 0,
      deductionsUsd: 0,
      deductionPercent: 0,
      netUsd: 10
    }
  );
});

test('summary percentage is calculated from aggregate gross and net amounts', () => {
  assert.equal(
    normalizeTipBreakdownSummary({ grossUsd: 30, netUsd: 24 }).deductionPercent,
    20
  );
});
