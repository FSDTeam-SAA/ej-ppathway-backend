// Credit consumption is not a second cash payment. Keep these ledgers separate.
export const CREDIT_TYPES = ['session_charge', 'session_refund', 'tip', 'advisor_tip',
  'advisor_earning', 'unlock_recording', 'unlock_transcript', 'promotion_purchase',
  'credit_expiration', 'free_credit_grant'];
export const REVENUE_TYPES = ['credit_pack_purchase', 'wallet_topup', 'subscription'];
export const CREDIT_SPEND_TYPES = ['session_charge', 'tip', 'unlock_recording', 'unlock_transcript'];

// Never assume a foreign-currency amount is USD if conversion was not recorded.
export const moneyUsdExpr = { $ifNull: ['$amountUsd', {
  $cond: [{ $eq: [{ $toLower: { $ifNull: ['$currency', 'usd'] } }, 'usd'] }, '$amount', 0]
}] };

export const transactionDisplay = (tx) => {
  const credits = CREDIT_TYPES.includes(tx.type);
  const usd = ['advisor_payout', 'advisor_tip_fiat'].includes(tx.type);
  return {
    displayAmount: usd ? (tx.netProceedsUsd ?? tx.amountUsd ?? tx.amount) : tx.amount,
    displayUnit: credits ? 'credits' : usd ? 'USD' : (tx.currency || 'usd').toUpperCase()
  };
};
