export const ADVISOR_TIP_TYPES = ['advisor_tip', 'advisor_tip_fiat'];

const legacyTipAmountUsdExpr = {
  $multiply: [
    { $ifNull: ['$amount', 0] },
    { $ifNull: ['$metadata.tipBalanceSplitRateUsd', 1] }
  ]
};

// Legacy advisor_tip amounts were stored as credits. The balance migration
// records the USD conversion rate on each transaction so historical reports
// can use the same value that was credited to the advisor's tip balance.
export const advisorTipAmountUsdExpr = {
  $cond: [
    { $eq: ['$type', 'advisor_tip'] },
    legacyTipAmountUsdExpr,
    { $ifNull: ['$netProceedsUsd', { $ifNull: ['$amountUsd', '$amount'] }] }
  ]
};

export const advisorTipGrossAmountUsdExpr = {
  $cond: [
    { $eq: ['$type', 'advisor_tip'] },
    legacyTipAmountUsdExpr,
    { $ifNull: ['$grossAmountUsd', { $ifNull: ['$amountUsd', '$amount'] }] }
  ]
};

export const advisorTipCommissionAmountUsdExpr = {
  $cond: [
    { $eq: ['$type', 'advisor_tip_fiat'] },
    { $ifNull: ['$commissionAmountUsd', 0] },
    0
  ]
};

export const advisorTipTaxAmountUsdExpr = {
  $cond: [
    { $eq: ['$type', 'advisor_tip_fiat'] },
    { $ifNull: ['$taxAmountUsd', 0] },
    0
  ]
};

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const legacyTipAmountUsd = (tip) =>
  Number(tip.amount || 0) * Number(tip.metadata?.tipBalanceSplitRateUsd || 1);

export const advisorTipDisplayAmountUsd = (tip) => {
  const value =
    tip.type === 'advisor_tip'
      ? legacyTipAmountUsd(tip)
      : Number(tip.netProceedsUsd ?? tip.amountUsd ?? tip.amount ?? 0);

  return round2(value);
};

export const advisorTipBreakdown = (tip) => {
  const direct = tip.type === 'advisor_tip';
  const grossUsd = round2(
    direct
      ? legacyTipAmountUsd(tip)
      : tip.grossAmountUsd ?? tip.amountUsd ?? tip.amount
  );
  const netUsd = advisorTipDisplayAmountUsd(tip);
  const commissionUsd = round2(direct ? 0 : tip.commissionAmountUsd);
  const taxUsd = round2(direct ? 0 : tip.taxAmountUsd);
  const deductionsUsd = round2(Math.max(0, grossUsd - netUsd));

  return {
    platform: direct ? 'direct' : tip.iapPlatform || 'unknown',
    grossUsd,
    commissionUsd,
    taxUsd,
    deductionsUsd,
    deductionPercent: grossUsd > 0 ? round2((deductionsUsd / grossUsd) * 100) : 0,
    netUsd
  };
};

export const normalizeTipBreakdownSummary = (value = {}) => {
  const grossUsd = round2(value.grossUsd);
  const netUsd = round2(value.netUsd);
  const deductionsUsd = round2(Math.max(0, grossUsd - netUsd));

  return {
    grossUsd,
    commissionUsd: round2(value.commissionUsd),
    taxUsd: round2(value.taxUsd),
    deductionsUsd,
    deductionPercent: grossUsd > 0 ? round2((deductionsUsd / grossUsd) * 100) : 0,
    netUsd,
    count: Number(value.count || 0),
    storeTipCount: Number(value.storeTipCount || 0),
    appStoreCount: Number(value.appStoreCount || 0),
    playStoreCount: Number(value.playStoreCount || 0)
  };
};

export const advisorTipBreakdownGroup = {
  grossUsd: { $sum: advisorTipGrossAmountUsdExpr },
  commissionUsd: { $sum: advisorTipCommissionAmountUsdExpr },
  taxUsd: { $sum: advisorTipTaxAmountUsdExpr },
  netUsd: { $sum: advisorTipAmountUsdExpr },
  count: { $sum: 1 },
  storeTipCount: {
    $sum: { $cond: [{ $eq: ['$type', 'advisor_tip_fiat'] }, 1, 0] }
  },
  appStoreCount: {
    $sum: {
      $cond: [{ $in: ['$iapPlatform', ['ios', 'app_store']] }, 1, 0]
    }
  },
  playStoreCount: {
    $sum: {
      $cond: [{ $in: ['$iapPlatform', ['android', 'play_store']] }, 1, 0]
    }
  }
};
