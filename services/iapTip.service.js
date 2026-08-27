import mongoose from 'mongoose';
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

const optionalMoney = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? round2(number) : null;
};

export const revenueBreakdown = (purchase, keys) => {
  const raw = keys.map((key) => purchase?.[key]).find((value) => value && typeof value === 'object');
  if (!raw) return null;
  const gross = optionalMoney(raw.gross ?? raw.amount ?? raw.value);
  const commission = optionalMoney(raw.commission);
  const tax = optionalMoney(raw.tax);
  const proceeds = optionalMoney(raw.proceeds);
  return {
    currency: String(raw.currency || '').toLowerCase(),
    gross,
    commission,
    tax,
    proceeds
  };
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

const REVENUECAT_LOOKUP_DELAYS_MS = [0, 500, 1500];

const wait = (milliseconds) =>
  milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();

/**
 * A newly completed StoreKit transaction can take a short time to appear in
 * RevenueCat's purchases search. Retry only empty/not-found, throttled, server,
 * and network responses; authentication/configuration errors fail immediately.
 */
export const lookupRevenueCatPurchase = async ({
  url,
  apiKey,
  fetchImpl = fetch,
  delaysMs = REVENUECAT_LOOKUP_DELAYS_MS
}) => {
  let lastResponse = null;
  let lastPayload = null;
  let lastError = null;

  for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
    await wait(delaysMs[attempt]);

    try {
      lastResponse = await fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`
        }
      });
      lastError = null;

      try {
        lastPayload = await lastResponse.json();
      } catch {
        lastPayload = null;
      }

      if (lastResponse.ok) {
        const purchase = purchaseItems(lastPayload)[0];
        if (purchase) return purchase;
      } else {
        const retryable =
          lastResponse.status === 404 ||
          lastResponse.status === 429 ||
          lastResponse.status >= 500;
        if (!retryable) break;
      }
    } catch (error) {
      lastError = error;
      lastResponse = null;
      lastPayload = null;
    }
  }

  if (lastResponse && !lastResponse.ok) {
    throw Object.assign(new Error('RevenueCat purchase verification failed'), {
      statusCode: lastResponse.status === 404 ? 400 : 502,
      details: lastPayload
    });
  }
  if (lastError) {
    throw Object.assign(new Error('RevenueCat purchase verification failed'), {
      statusCode: 502,
      cause: lastError
    });
  }
  throw Object.assign(new Error('Purchase was not found in RevenueCat'), { statusCode: 400 });
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
      localGrossAmount: round2(amount),
      localCommissionAmount: 0,
      localTaxAmount: 0,
      localNetProceeds: round2(amount),
      grossAmountUsd: round2(amountUsd),
      commissionAmountUsd: 0,
      taxAmountUsd: 0,
      netProceedsUsd: round2(amountUsd),
      platform: platform || 'unknown',
      raw: null
    };
  }

  if (!storeTransactionId) {
    throw Object.assign(new Error('storeTransactionId is required'), { statusCode: 400 });
  }

  const url = new URL(`https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}/purchases`);
  url.searchParams.set('store_purchase_identifier', storeTransactionId);

  const purchase = await lookupRevenueCatPurchase({ url, apiKey });

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

  const localRevenue = revenueBreakdown(purchase, [
    'revenue_in_local_currency',
    'revenueInLocalCurrency'
  ]);
  const usdRevenue = revenueBreakdown(purchase, ['revenue_in_usd', 'revenueInUsd']);

  // Store tips are paid from RevenueCat proceeds, never from a client-supplied
  // amount or the product's face value. A newly visible purchase can briefly
  // lack revenue details; keeping it retryable is safer than over-crediting.
  if (
    !localRevenue?.currency ||
    !Number.isFinite(localRevenue.gross) ||
    localRevenue.gross <= 0 ||
    !Number.isFinite(localRevenue.proceeds) ||
    localRevenue.proceeds < 0 ||
    !Number.isFinite(usdRevenue?.gross) ||
    usdRevenue.gross <= 0 ||
    !Number.isFinite(usdRevenue?.proceeds) ||
    usdRevenue.proceeds < 0
  ) {
    throw Object.assign(new Error('RevenueCat net proceeds are not available yet'), {
      statusCode: 409,
      retryable: true
    });
  }

  return {
    verified: true,
    productId,
    storeTransactionId,
    revenueCatPurchaseId: purchase.id,
    amount: localRevenue.gross,
    currency: localRevenue.currency,
    amountUsd: usdRevenue.gross,
    localGrossAmount: localRevenue.gross,
    localCommissionAmount: localRevenue.commission ?? 0,
    localTaxAmount: localRevenue.tax ?? 0,
    localNetProceeds: localRevenue.proceeds,
    grossAmountUsd: usdRevenue.gross,
    commissionAmountUsd: usdRevenue.commission ?? 0,
    taxAmountUsd: usdRevenue.tax ?? 0,
    netProceedsUsd: usdRevenue.proceeds,
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
  if (session.status !== 'completed') {
    throw Object.assign(new Error('Tips are available after a completed session'), { statusCode: 409 });
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

  const revenueFields = {
    localGrossAmount: verified.localGrossAmount,
    localCommissionAmount: verified.localCommissionAmount,
    localTaxAmount: verified.localTaxAmount,
    localNetProceeds: verified.localNetProceeds,
    grossAmountUsd: verified.grossAmountUsd,
    commissionAmountUsd: verified.commissionAmountUsd,
    taxAmountUsd: verified.taxAmountUsd,
    netProceedsUsd: verified.netProceedsUsd
  };
  const revenueMetadata = {
    verified: verified.verified,
    storeTransactionId: verified.storeTransactionId,
    revenueCatTransactionId: verified.storeTransactionId,
    revenueCatPurchaseId: verified.revenueCatPurchaseId,
    iapProductId: verified.productId,
    localCurrency: verified.currency,
    ...revenueFields
  };

  const dbSession = await mongoose.startSession();
  let result;
  try {
    await dbSession.withTransaction(async () => {
      const currentSession = await Session.findById(sessionId).session(dbSession);
      if (!currentSession) throw Object.assign(new Error('Session not found'), { statusCode: 404 });
      if (String(currentSession.user) !== String(userId)) {
        throw Object.assign(new Error('Only the user can tip'), { statusCode: 403 });
      }
      if (currentSession.status !== 'completed') {
        throw Object.assign(new Error('Tips are available after a completed session'), { statusCode: 409 });
      }

      const duplicate = await Transaction.findOne({ storeTransactionId }).session(dbSession);
      if (duplicate) {
        result = { duplicate: true, transaction: duplicate, session: currentSession };
        return;
      }

      const [userTip] = await Transaction.create(
        [{
          type: 'tip_fiat',
          status: 'completed',
          provider: 'revenuecat',
          user: currentSession.user,
          advisor: currentSession.advisor,
          session: currentSession._id,
          amount: verified.amount,
          currency: verified.currency,
          amountUsd: verified.grossAmountUsd,
          ...revenueFields,
          iapProductId: verified.productId,
          iapPlatform: normalizeIapPlatform(verified.platform),
          storeTransactionId: verified.storeTransactionId,
          revenueCatPurchaseId: verified.revenueCatPurchaseId,
          description: `Tip for session ${currentSession.sessionCode} via in-app purchase`,
          metadata: revenueMetadata
        }],
        { session: dbSession }
      );

      const [advisorTip] = await Transaction.create(
        [{
          type: 'advisor_tip_fiat',
          status: 'completed',
          provider: 'revenuecat',
          user: currentSession.user,
          advisor: currentSession.advisor,
          session: currentSession._id,
          sourceTransaction: userTip._id,
          amount: verified.netProceedsUsd,
          currency: 'usd',
          amountUsd: verified.netProceedsUsd,
          ...revenueFields,
          iapProductId: verified.productId,
          iapPlatform: normalizeIapPlatform(verified.platform),
          revenueCatPurchaseId: verified.revenueCatPurchaseId,
          description: `Net IAP tip received from session ${currentSession.sessionCode}`,
          metadata: revenueMetadata
        }],
        { session: dbSession }
      );

      await Wallet.findOneAndUpdate(
        { user: currentSession.advisor },
        {
          $inc: {
            tipEarningsBalanceUsd: verified.netProceedsUsd,
            totalTipEarnedUsd: verified.netProceedsUsd
          },
          $setOnInsert: { user: currentSession.advisor }
        },
        { upsert: true, session: dbSession }
      );

      currentSession.tipAmountFiatUsd = round2(
        (currentSession.tipAmountFiatUsd || 0) + verified.grossAmountUsd
      );
      currentSession.tipNetAmountFiatUsd = round2(
        (currentSession.tipNetAmountFiatUsd || 0) + verified.netProceedsUsd
      );
      currentSession.tipCount = (currentSession.tipCount || 0) + 1;
      await currentSession.save({ session: dbSession });

      result = {
        duplicate: false,
        transaction: userTip,
        advisorTransaction: advisorTip,
        session: currentSession,
        netProceedsUsd: verified.netProceedsUsd
      };
    });
  } catch (error) {
    if (error?.code === 11000) {
      const duplicate = await Transaction.findOne({ storeTransactionId });
      if (duplicate) return { duplicate: true, transaction: duplicate, session };
    }
    throw error;
  } finally {
    await dbSession.endSession();
  }
  return result;
};

export const reverseIapTipByStoreTransactionId = async (storeTransactionIds) => {
  const ids = (Array.isArray(storeTransactionIds) ? storeTransactionIds : [storeTransactionIds])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (!ids.length) return null;

  const dbSession = await mongoose.startSession();
  let result = null;
  try {
    await dbSession.withTransaction(async () => {
      const userTip = await Transaction.findOne({
        storeTransactionId: { $in: ids },
        type: 'tip_fiat'
      }).session(dbSession);
      if (!userTip || userTip.status === 'refunded') {
        if (userTip) userTip.$locals.refundApplied = false;
        result = userTip;
        return;
      }

      const refundedAt = new Date();
      const advisorTip = await Transaction.findOne({
        sourceTransaction: userTip._id,
        type: 'advisor_tip_fiat'
      }).session(dbSession);

      userTip.status = 'refunded';
      userTip.$locals.refundApplied = true;
      userTip.metadata = { ...(userTip.metadata || {}), refundedAt };
      await userTip.save({ session: dbSession });

      if (advisorTip && advisorTip.status !== 'refunded') {
        const netProceedsUsd = round2(
          advisorTip.netProceedsUsd ?? advisorTip.amountUsd ?? advisorTip.amount
        );
        advisorTip.status = 'refunded';
        advisorTip.metadata = { ...(advisorTip.metadata || {}), refundedAt };
        await advisorTip.save({ session: dbSession });

        // A negative available tip balance is intentional if the advisor was
        // already paid; future earnings offset the refund debt.
        await Wallet.findOneAndUpdate(
          { user: advisorTip.advisor },
          {
            $inc: {
              tipEarningsBalanceUsd: -netProceedsUsd,
              totalTipEarnedUsd: -netProceedsUsd
            }
          },
          { session: dbSession }
        );

        await Session.findByIdAndUpdate(
          userTip.session,
          {
            $inc: {
              tipAmountFiatUsd: -round2(userTip.grossAmountUsd ?? userTip.amountUsd ?? 0),
              tipNetAmountFiatUsd: -netProceedsUsd,
              tipCount: -1
            }
          },
          { session: dbSession }
        );
      }
      result = userTip;
    });
  } finally {
    await dbSession.endSession();
  }
  return result;
};

const normalizeIapPlatform = (value) => {
  const platform = String(value || '').toLowerCase();
  if (['ios', 'app_store', 'app store'].includes(platform)) return 'ios';
  if (['android', 'play_store', 'google_play', 'play store'].includes(platform)) return 'android';
  return 'unknown';
};
