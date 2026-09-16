import crypto from 'node:crypto';

const APPLE_API_BASE = 'https://api.appstoreconnect.apple.com';
const GOOGLE_API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

const hasValue = (name) => Boolean(String(process.env[name] || '').trim());

const providerStatus = (requiredEnvironmentVariables) => {
  const missing = requiredEnvironmentVariables.filter((name) => !hasValue(name));
  return { configured: missing.length === 0, missingEnvironmentVariables: missing };
};

export const getStorePricingConfiguration = () => ({
  apple: providerStatus([
    'APP_STORE_CONNECT_ISSUER_ID',
    'APP_STORE_CONNECT_KEY_ID',
    'APP_STORE_CONNECT_PRIVATE_KEY',
    'APP_STORE_CONNECT_APP_ID'
  ]),
  google: providerStatus([
    'GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_PLAY_PACKAGE_NAME'
  ]),
  revenueCat: providerStatus(['REVENUECAT_SECRET_API_KEY', 'REVENUECAT_PROJECT_ID'])
});

const base64urlJson = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const normalizePrivateKey = (value) => String(value || '').replace(/\\n/g, '\n');

const priceToCents = (value) => {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0 || price > 100000) {
    throw new Error('Store price must be greater than 0 and no more than 100000 USD');
  }
  return Math.round((price + Number.EPSILON) * 100);
};

const formatUsd = (value) => (priceToCents(value) / 100).toFixed(2);
const usdMoney = (value) => {
  const cents = priceToCents(value);
  return {
    currencyCode: 'USD',
    units: String(Math.floor(cents / 100)),
    nanos: (cents % 100) * 10_000_000
  };
};

const moneyToCents = (money = {}) => (
  (Number(money.units || 0) * 100) + Math.round(Number(money.nanos || 0) / 10_000_000)
);

export const createAppleInlineId = () => (
  `\${price-${Date.now()}-${crypto.randomBytes(4).toString('hex')}}`
);

const errorMessageFromBody = (body, fallback) => {
  if (Array.isArray(body?.errors) && body.errors.length) {
    return body.errors.map((error) => error.detail || error.title || error.code).filter(Boolean).join('; ');
  }
  return body?.error?.message || body?.message || fallback;
};

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 300) };
    }
  }
  if (!response.ok) {
    throw new Error(errorMessageFromBody(body, `Store API request failed (${response.status})`));
  }
  return body || {};
};

const createAppleToken = () => {
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64urlJson({ alg: 'ES256', kid: process.env.APP_STORE_CONNECT_KEY_ID, typ: 'JWT' });
  const encodedPayload = base64urlJson({
    iss: process.env.APP_STORE_CONNECT_ISSUER_ID,
    iat: now,
    exp: now + 15 * 60,
    aud: 'appstoreconnect-v1'
  });
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign('sha256', Buffer.from(unsignedToken), {
    key: normalizePrivateKey(process.env.APP_STORE_CONNECT_PRIVATE_KEY),
    dsaEncoding: 'ieee-p1363'
  });
  return `${unsignedToken}.${signature.toString('base64url')}`;
};

const appleHeaders = (token, withJson = false) => ({
  Authorization: `Bearer ${token}`,
  ...(withJson ? { 'Content-Type': 'application/json' } : {})
});

const findAppleProduct = async (token, productId) => {
  let url = `${APPLE_API_BASE}/v1/apps/${encodeURIComponent(process.env.APP_STORE_CONNECT_APP_ID)}/inAppPurchasesV2?limit=200`;
  while (url) {
    const body = await requestJson(url, { headers: appleHeaders(token) });
    const product = (body.data || []).find((item) => item.attributes?.productId === productId);
    if (product) return product;
    url = body.links?.next || null;
  }
  throw new Error(`Apple product ${productId} was not found`);
};

const findAppleUsdPricePoint = async (token, appleProductInternalId, priceUsd) => {
  const expected = formatUsd(priceUsd);
  let url = `${APPLE_API_BASE}/v2/inAppPurchases/${encodeURIComponent(appleProductInternalId)}/pricePoints?filter%5Bterritory%5D=USA&limit=200`;
  while (url) {
    const body = await requestJson(url, { headers: appleHeaders(token) });
    const pricePoint = (body.data || []).find(
      (item) => Number(item.attributes?.customerPrice).toFixed(2) === expected
    );
    if (pricePoint) return pricePoint;
    url = body.links?.next || null;
  }
  throw new Error(`Apple does not offer an exact $${expected} USD price point. Choose an available Apple price such as 34.99 or 59.99.`);
};

const getCurrentAppleUsdPrice = async (token, appleProductInternalId) => {
  const url = `${APPLE_API_BASE}/v1/inAppPurchasePriceSchedules/${encodeURIComponent(appleProductInternalId)}/manualPrices?filter%5Bterritory%5D=USA&include=inAppPurchasePricePoint&limit=50`;
  const body = await requestJson(url, { headers: appleHeaders(token) });
  const now = new Date().toISOString().slice(0, 10);
  const current = (body.data || [])
    .filter((item) => (!item.attributes?.startDate || item.attributes.startDate <= now)
      && (!item.attributes?.endDate || item.attributes.endDate >= now))
    .sort((a, b) => String(b.attributes?.startDate || '').localeCompare(String(a.attributes?.startDate || '')))[0];
  const pointId = current?.relationships?.inAppPurchasePricePoint?.data?.id;
  const pricePoint = (body.included || []).find((item) => item.id === pointId);
  const price = Number(pricePoint?.attributes?.customerPrice);
  return Number.isFinite(price) ? price : null;
};

export const getAppleInAppPurchaseCurrentPrice = async ({ productId }) => {
  const status = getStorePricingConfiguration().apple;
  if (!status.configured) throw new Error('Apple pricing is not configured');
  const token = createAppleToken();
  const product = await findAppleProduct(token, productId);
  const priceUsd = await getCurrentAppleUsdPrice(token, product.id);
  if (priceUsd === null) throw new Error(`Apple current USD price was not found for ${productId}`);
  return { productId, priceUsd };
};

export const updateAppleInAppPurchasePrice = async ({ productId, priceUsd }) => {
  const status = getStorePricingConfiguration().apple;
  if (!status.configured) {
    throw new Error(`Apple pricing is not configured. Missing: ${status.missingEnvironmentVariables.join(', ')}`);
  }

  const token = createAppleToken();
  const product = await findAppleProduct(token, productId);
  const currentPrice = await getCurrentAppleUsdPrice(token, product.id);
  if (currentPrice !== null && priceToCents(currentPrice) === priceToCents(priceUsd)) {
    return { productId, priceUsd: currentPrice, scheduleId: null, unchanged: true };
  }
  const pricePoint = await findAppleUsdPricePoint(token, product.id, priceUsd);
  const manualPriceId = createAppleInlineId();
  const payload = {
    data: {
      type: 'inAppPurchasePriceSchedules',
      relationships: {
        inAppPurchase: { data: { type: 'inAppPurchases', id: product.id } },
        baseTerritory: { data: { type: 'territories', id: 'USA' } },
        manualPrices: { data: [{ type: 'inAppPurchasePrices', id: manualPriceId }] }
      }
    },
    included: [{
      type: 'inAppPurchasePrices',
      id: manualPriceId,
      attributes: { startDate: null },
      relationships: {
        inAppPurchaseV2: { data: { type: 'inAppPurchases', id: product.id } },
        inAppPurchasePricePoint: { data: { type: 'inAppPurchasePricePoints', id: pricePoint.id } }
      }
    }]
  };

  const body = await requestJson(`${APPLE_API_BASE}/v1/inAppPurchasePriceSchedules`, {
    method: 'POST',
    headers: appleHeaders(token, true),
    body: JSON.stringify(payload)
  });
  return {
    productId,
    priceUsd: Number(pricePoint.attributes.customerPrice),
    scheduleId: body.data?.id || null
  };
};

const createGoogleAssertion = () => {
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64urlJson({ alg: 'RS256', typ: 'JWT' });
  const encodedPayload = base64urlJson({
    iss: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 60 * 60
  });
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(unsignedToken),
    normalizePrivateKey(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY)
  );
  return `${unsignedToken}.${signature.toString('base64url')}`;
};

const getGoogleAccessToken = async () => {
  const body = await requestJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: createGoogleAssertion()
    })
  });
  if (!body.access_token) throw new Error('Google OAuth did not return an access token');
  return body.access_token;
};

const googleHeaders = (token, withJson = false) => ({
  Authorization: `Bearer ${token}`,
  ...(withJson ? { 'Content-Type': 'application/json' } : {})
});

const stripGoogleOutputFields = (purchaseOption) => {
  const { state: _state, ...writeable } = purchaseOption;
  return writeable;
};

const selectGoogleBuyOption = (product) => {
  const options = Array.isArray(product.purchaseOptions) ? product.purchaseOptions : [];
  return options.find((option) => option.state === 'ACTIVE' && option.buyOption)
    || options.find((option) => option.purchaseOptionId === 'standard' && option.buyOption)
    || options.find((option) => option.buyOption);
};

export const getGoogleOneTimeProductCurrentPrice = async ({ productId }) => {
  const status = getStorePricingConfiguration().google;
  if (!status.configured) throw new Error('Google pricing is not configured');
  const token = await getGoogleAccessToken();
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  const product = await requestJson(
    `${GOOGLE_API_BASE}/applications/${encodeURIComponent(packageName)}/oneTimeProducts/${encodeURIComponent(productId)}`,
    { headers: googleHeaders(token) }
  );
  const option = selectGoogleBuyOption(product);
  if (!option) throw new Error(`Google product ${productId} has no buy purchase option`);
  const usConfig = (option.regionalPricingAndAvailabilityConfigs || []).find((config) => config.regionCode === 'US');
  if (!usConfig?.price) throw new Error(`Google current USD price was not found for ${productId}`);
  return {
    productId,
    priceUsd: moneyToCents(usConfig.price) / 100,
    purchaseOptionId: option.purchaseOptionId
  };
};

export const updateGoogleOneTimeProductPrice = async ({ productId, priceUsd }) => {
  const status = getStorePricingConfiguration().google;
  if (!status.configured) {
    throw new Error(`Google pricing is not configured. Missing: ${status.missingEnvironmentVariables.join(', ')}`);
  }

  const token = await getGoogleAccessToken();
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  const encodedPackage = encodeURIComponent(packageName);
  const encodedProduct = encodeURIComponent(productId);
  const product = await requestJson(
    `${GOOGLE_API_BASE}/applications/${encodedPackage}/oneTimeProducts/${encodedProduct}`,
    { headers: googleHeaders(token) }
  );
  const purchaseOptions = Array.isArray(product.purchaseOptions) ? product.purchaseOptions : [];
  const targetOption = selectGoogleBuyOption(product);
  if (!targetOption) throw new Error(`Google product ${productId} has no buy purchase option`);
  const currentUsConfig = (targetOption.regionalPricingAndAvailabilityConfigs || [])
    .find((config) => config.regionCode === 'US');
  if (currentUsConfig?.price && moneyToCents(currentUsConfig.price) === priceToCents(priceUsd)) {
    return {
      productId,
      priceUsd: moneyToCents(currentUsConfig.price) / 100,
      purchaseOptionId: targetOption.purchaseOptionId,
      unchanged: true
    };
  }

  const converted = await requestJson(
    `${GOOGLE_API_BASE}/applications/${encodedPackage}/pricing:convertRegionPrices`,
    {
      method: 'POST',
      headers: googleHeaders(token, true),
      body: JSON.stringify({ price: usdMoney(priceUsd) })
    }
  );
  const convertedRegions = converted.convertedRegionPrices || {};
  const currentConfigs = targetOption.regionalPricingAndAvailabilityConfigs || [];
  const regionalPricingAndAvailabilityConfigs = currentConfigs.map((config) => ({
    ...config,
    ...(config.regionCode === 'US'
      ? { price: usdMoney(priceUsd) }
      : convertedRegions[config.regionCode]?.price
        ? { price: convertedRegions[config.regionCode].price }
        : {})
  }));
  const otherRegions = converted.convertedOtherRegionsPrice || {};
  const updatedTargetOption = {
    ...stripGoogleOutputFields(targetOption),
    regionalPricingAndAvailabilityConfigs,
    newRegionsConfig: {
      ...(targetOption.newRegionsConfig || {}),
      ...(otherRegions.usdPrice ? { usdPrice: otherRegions.usdPrice } : {}),
      ...(otherRegions.eurPrice ? { eurPrice: otherRegions.eurPrice } : {})
    }
  };
  const updatedOptions = purchaseOptions.map((option) =>
    option.purchaseOptionId === targetOption.purchaseOptionId
      ? updatedTargetOption
      : stripGoogleOutputFields(option)
  );
  const regionVersion = converted.regionVersion?.version || product.regionsVersion?.version;
  if (!regionVersion) throw new Error('Google did not return a regions version for the price update');

  const query = new URLSearchParams({
    updateMask: 'purchaseOptions',
    'regionsVersion.version': regionVersion
  });
  await requestJson(
    `${GOOGLE_API_BASE}/applications/${encodedPackage}/onetimeproducts/${encodedProduct}?${query}`,
    {
      method: 'PATCH',
      headers: googleHeaders(token, true),
      body: JSON.stringify({ packageName, productId, purchaseOptions: updatedOptions })
    }
  );
  return {
    productId,
    priceUsd: priceToCents(priceUsd) / 100,
    purchaseOptionId: targetOption.purchaseOptionId
  };
};

const settledProviderResult = (provider, result) => result.status === 'fulfilled'
  ? { provider, success: true, ...result.value }
  : { provider, success: false, error: result.reason?.message || 'Unknown store error' };

export const syncCreditPackStorePrice = async (pack) => {
  const [apple, google] = await Promise.allSettled([
    updateAppleInAppPurchasePrice({
      productId: String(pack.appleProductId || '').trim(),
      priceUsd: pack.priceUsd
    }),
    updateGoogleOneTimeProductPrice({
      productId: String(pack.googleProductId || '').trim(),
      priceUsd: pack.priceUsd
    })
  ]);
  const providers = [
    settledProviderResult('apple', apple),
    settledProviderResult('google', google)
  ];
  return {
    packId: pack.id,
    requestedPriceUsd: priceToCents(pack.priceUsd) / 100,
    success: providers.every((result) => result.success),
    providers
  };
};
