import { getPayoutConfig } from './payout.service.js';
import Transaction from '../models/transaction.model.js';
import Wallet from '../models/wallet.model.js';
import Session from '../models/session.model.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const DEFAULT_TIP_AMOUNTS_USD = new Map([
  ['tip_5', 5],
  ['tip_10', 10],
  ['tip_20', 20],
  ['tip_50', 50]
]);

const envList = (name) =>
  String(process.env[name] || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const tipProductIds = () => envList('IAP_TIP_PRODUCT_IDS');

const configuredTipProductIds = () => {
  const configured = tipProductIds();
  return configured.length ? configured : [...DEFAULT_TIP_AMOUNTS_USD.keys()];
};

const isAllowedTipProduct = (productId) => {
  const id = String(productId || '').trim();
  if (!id) return false;
  return configuredTipProductIds().includes(id);
};

const revenueCatApiKey = () =>
  process.env.REVENUECAT_API_KEY ||
  process.env.REVENUECAT_SECRET_API_KEY ||
  process.env.REVENUECAT_V2_API_KEY ||
  '';

const revenueAmount = (purchase, key) => {
  const value =
    purchase?.[key]?.gross ??
    purchase?.[key]?.proceeds ??
    purchase?.[key]?.amount ??
    purchase?.[key]?.value;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const revenueCurrency = (purchase, key) => {
  const value = purchase?.[key]?.currency;
  return value ? String(value).toLowerCase() : '';
};

const purchaseProductIds = (purchase) =>
  [
    purchase?.product_id,
    purchase?.product_identifier,
    purchase?.product_store_identifier,
    purchase?.store_product_identifier,
    purchase?.store_identifier,
    purchase?.product?.id,
    purchase?.product?.store_identifier
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

const purchaseCustomerIds = (purchase) =>
  [purchase?.customer_id, purchase?.original_customer_id, purchase?.app_user_id, purchase?.appUserId]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

const purchaseItems = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.purchases)) return payload.purchases;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.object === 'purchase') return [payload];
  if (payload?.purchase) return [payload.purchase];
  return [];
};

export const verifyRevenueCatTipPurchase = async ({
  productId,
  storeTransactionId,
  appUserId,
  fallbackAmount,
  fallbackCurrency,
  fallbackAmountUsd,
  platform
}) => {
  if (!isAllowedTipProduct(productId)) {
    throw Object.assign(new Error('Unknown tip product'), { statusCode: 400 });
  }

  const apiKey = revenueCatApiKey();
  const projectId = process.env.REVENUECAT_PROJECT_ID;
  const allowUnverified = process.env.IAP_TIP_ALLOW_UNVERIFIED === 'true';
  const configuredAmountUsd = DEFAULT_TIP_AMOUNTS_USD.get(productId);

  if (!apiKey || !projectId) {
    if (!allowUnverified) {
      throw Object.assign(
        new Error('RevenueCat verification is not configured for IAP tips'),
        { statusCode: 503 }
      );
    }
    const amount = Number(fallbackAmount);
    const amountUsd = Number(
      configuredAmountUsd ??
      fallbackAmountUsd ??
      (String(fallbackCurrency).toLowerCase() === 'usd' ? amount : NaN)
    );
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw Object.assign(new Error('Verified tip amount is required'), { statusCode: 400 });
    }
    return {
      verified: false,
      productId,
      storeTransactionId,
      amount: round2(amount),
      currency: String(fallbackCurrency || 'usd').toLowerCase(),
      amountUsd: round2(amountUsd),
      platform: platform || 'unknown',
      raw: null
    };
  }

  if (!storeTransactionId) {
    throw Object.assign(new Error('storeTransactionId is required'), { statusCode: 400 });
  }

  const url = new URL(`https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}/purchases`);
  url.searchParams.set('store_purchase_identifier', storeTransactionId);

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`
    }
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw Object.assign(new Error('RevenueCat purchase verification failed'), {
      statusCode: response.status === 404 ? 400 : 502,
      details: payload
    });
  }

  const purchases = purchaseItems(payload);
  const purchase = purchases[0];
  if (!purchase) {
    throw Object.assign(new Error('Purchase was not found in RevenueCat'), { statusCode: 400 });
  }

  const productMatches = purchaseProductIds(purchase).includes(String(productId));
  if (purchaseProductIds(purchase).length && !productMatches) {
    throw Object.assign(new Error('Purchase product does not match tip product'), { statusCode: 400 });
  }

  const customerIds = purchaseCustomerIds(purchase);
  if (customerIds.length && appUserId && !customerIds.includes(String(appUserId))) {
    throw Object.assign(new Error('Purchase does not belong to this user'), { statusCode: 403 });
  }

  if (purchase.refunded_at || purchase.refundedAt || purchase.is_refunded === true) {
    throw Object.assign(new Error('Purchase has been refunded'), { statusCode: 409 });
  }

  const localAmount =
    revenueAmount(purchase, 'revenue_in_local_currency') ??
    revenueAmount(purchase, 'revenueInLocalCurrency') ??
    Number(fallbackAmount);
  const localCurrency =
    revenueCurrency(purchase, 'revenue_in_local_currency') ||
    revenueCurrency(purchase, 'revenueInLocalCurrency') ||
    String(fallbackCurrency || 'usd').toLowerCase();
  const amountUsd =
    revenueAmount(purchase, 'revenue_in_usd') ??
    revenueAmount(purchase, 'revenueInUsd') ??
    configuredAmountUsd ??
    Number(fallbackAmountUsd ?? (localCurrency === 'usd' ? localAmount : NaN));

  if (!Number.isFinite(localAmount) || localAmount <= 0 || !Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw Object.assign(new Error('Verified purchase amount is invalid'), { statusCode: 400 });
  }

  return {
    verified: true,
    productId,
    storeTransactionId,
    revenueCatPurchaseId: purchase.id,
    amount: round2(localAmount),
    currency: localCurrency,
    amountUsd: round2(amountUsd),
    platform: purchase.store || platform || 'unknown',
    raw: purchase
  };
};

export const recordIapTip = async ({ userId, sessionId, body }) => {
  const session = await Session.findById(sessionId);
  if (!session) throw Object.assign(new Error('Session not found'), { statusCode: 404 });
  if (String(session.user) !== String(userId)) {
    throw Object.assign(new Error('Only the user can tip'), { statusCode: 403 });
  }

  const productId = String(body.productId || body.iapProductId || '').trim();
  const storeTransactionId = String(
    body.storeTransactionId ||
    body.revenueCatTransactionId ||
    body.transactionId ||
    ''
  ).trim();
  if (!storeTransactionId) {
    throw Object.assign(new Error('storeTransactionId is required'), { statusCode: 400 });
  }

  const existing = await Transaction.findOne({
    $or: [
      { storeTransactionId },
      { 'metadata.storeTransactionId': storeTransactionId },
      { 'metadata.revenueCatTransactionId': storeTransactionId }
    ]
  });
  if (existing) return { duplicate: true, transaction: existing, session };

  const verified = await verifyRevenueCatTipPurchase({
    productId,
    storeTransactionId,
    appUserId: userId,
    fallbackAmount: body.amount,
    fallbackCurrency: body.currency,
    fallbackAmountUsd: body.amountUsd,
    platform: body.platform
  });

  const payoutCfg = await getPayoutConfig();
  const payoutRate = Number(payoutCfg.payoutCreditUsdRate || 1);
  const payoutCredits = payoutRate > 0 ? round2(verified.amountUsd / payoutRate) : round2(verified.amountUsd);

  const userTip = await Transaction.create({
    type: 'tip_fiat',
    status: 'completed',
    provider: 'revenuecat',
    user: session.user,
    advisor: session.advisor,
    session: session._id,
    amount: verified.amount,
    currency: verified.currency,
    amountUsd: verified.amountUsd,
    iapProductId: verified.productId,
    iapPlatform: normalizeIapPlatform(verified.platform),
    storeTransactionId: verified.storeTransactionId,
    revenueCatPurchaseId: verified.revenueCatPurchaseId,
    description: `Tip for session ${session.sessionCode} via in-app purchase`,
    metadata: {
      verified: verified.verified,
      storeTransactionId: verified.storeTransactionId,
      revenueCatTransactionId: verified.storeTransactionId,
      revenueCatPurchaseId: verified.revenueCatPurchaseId,
      iapProductId: verified.productId,
      localAmount: verified.amount,
      localCurrency: verified.currency,
      amountUsd: verified.amountUsd,
      payoutCredits
    }
  });

  const advisorTip = await Transaction.create({
    type: 'advisor_tip_fiat',
    status: 'completed',
    provider: 'revenuecat',
    user: session.user,
    advisor: session.advisor,
    session: session._id,
    sourceTransaction: userTip._id,
    amount: verified.amount,
    currency: verified.currency,
    amountUsd: verified.amountUsd,
    iapProductId: verified.productId,
    iapPlatform: normalizeIapPlatform(verified.platform),
    revenueCatPurchaseId: verified.revenueCatPurchaseId,
    payoutCredits,
    payoutRateUsd: payoutRate,
    description: `IAP tip received from session ${session.sessionCode}`,
    metadata: {
      verified: verified.verified,
      storeTransactionId: verified.storeTransactionId,
      revenueCatTransactionId: verified.storeTransactionId,
      revenueCatPurchaseId: verified.revenueCatPurchaseId,
      iapProductId: verified.productId,
      localAmount: verified.amount,
      localCurrency: verified.currency,
      amountUsd: verified.amountUsd
    }
  });

  await Wallet.findOneAndUpdate(
    { user: session.advisor },
    {
      $inc: { earningsBalance: payoutCredits, totalEarned: payoutCredits },
      $setOnInsert: { user: session.advisor }
    },
    { upsert: true }
  );

  session.tipAmount = round2((session.tipAmount || 0) + payoutCredits);
  session.tipAmountFiatUsd = round2((session.tipAmountFiatUsd || 0) + verified.amountUsd);
  session.tipCount = (session.tipCount || 0) + 1;
  await session.save();

  return { duplicate: false, transaction: userTip, advisorTransaction: advisorTip, session, payoutCredits };
};

export const reverseIapTipByStoreTransactionId = async (storeTransactionId) => {
  const id = String(storeTransactionId || '').trim();
  if (!id) return null;

  const userTip = await Transaction.findOne({ storeTransactionId: id });
  if (!userTip || userTip.type !== 'tip_fiat' || userTip.status === 'refunded') return userTip;

  const advisorTip = await Transaction.findOne({
    sourceTransaction: userTip._id,
    type: 'advisor_tip_fiat'
  });

  userTip.status = 'refunded';
  userTip.metadata = { ...(userTip.metadata || {}), refundedAt: new Date() };
  await userTip.save();

  if (advisorTip && advisorTip.status !== 'refunded') {
    const payoutCredits = round2(advisorTip.payoutCredits ?? advisorTip.amount);
    await Wallet.findOneAndUpdate(
      { user: advisorTip.advisor },
      { $inc: { earningsBalance: -payoutCredits, totalEarned: -payoutCredits } }
    );
    advisorTip.status = 'refunded';
    advisorTip.metadata = { ...(advisorTip.metadata || {}), refundedAt: new Date() };
    await advisorTip.save();
  }

  return userTip;
};

const normalizeIapPlatform = (value) => {
  const platform = String(value || '').toLowerCase();
  if (['ios', 'app_store', 'app store'].includes(platform)) return 'ios';
  if (['android', 'play_store', 'google_play', 'play store'].includes(platform)) return 'android';
  return 'unknown';
};
