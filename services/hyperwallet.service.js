import {
  hyperwalletFetch,
  hyperwalletErrorMessage,
  getHyperwalletProgramToken
} from '../config/hyperwallet.js';

/**
 * Hyperwallet Orders/Payments helpers — the payout counterpart to the Stripe /
 * PayPal top-up services. The typical lifecycle for paying an advisor is:
 *
 *   1. ensureHyperwalletUser(advisor)        → creates a Hyperwallet "user" (payee)
 *   2. createBankAccount / createPaypalAccount → attaches a transfer method (trm-…)
 *   3. createPayment({ destinationToken, amount, currency }) → moves the money
 *   4. getPayment(paymentToken) / webhook    → track COMPLETED / FAILED
 *
 * The Hyperwallet user token + transfer method token are persisted on the User
 * document so we only create them once.
 */

const money = (amount) => (Number(amount) || 0).toFixed(2);

const firstLast = (name = '') => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Advisor', lastName: 'User' };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
};

/**
 * Create a Hyperwallet user (payee) for an advisor.
 * @param {object} advisor  Mongoose User doc / lean object
 * @param {object} [extra]  optional address overrides { addressLine1, city, stateProvince, country, postalCode }
 * @returns {Promise<object>} raw Hyperwallet user (contains `token`)
 */
export const createHyperwalletUser = async (advisor, extra = {}) => {
  const { firstName, lastName } = firstLast(advisor?.name);
  const country = (extra.country || advisor?.country || process.env.DEFAULT_COUNTRY || 'US')
    .toString()
    .toUpperCase()
    .slice(0, 2);

  const body = {
    programToken: getHyperwalletProgramToken(),
    clientUserId: String(advisor?._id || extra.clientUserId),
    profileType: 'INDIVIDUAL',
    firstName,
    lastName,
    email: advisor?.email,
    addressLine1: extra.addressLine1 || advisor?.city || 'N/A',
    city: extra.city || advisor?.city || 'N/A',
    stateProvince: extra.stateProvince || advisor?.state || 'N/A',
    country,
    postalCode: extra.postalCode || '00000'
  };

  const { ok, data } = await hyperwalletFetch('/users', { method: 'POST', body });
  if (!ok || !data.token) {
    // A user with this clientUserId may already exist — surface a clear message.
    throw new Error(hyperwalletErrorMessage(data, 'Failed to create Hyperwallet user'));
  }
  return data;
};

/** Look up an existing Hyperwallet user by our advisor id (clientUserId). */
export const findHyperwalletUserByClientId = async (clientUserId) => {
  const { ok, data } = await hyperwalletFetch(
    `/users?clientUserId=${encodeURIComponent(String(clientUserId))}`
  );
  if (!ok) return null;
  return (data?.data || [])[0] || null;
};

/**
 * Attach a bank account (ACH) transfer method to a Hyperwallet user.
 * @returns {Promise<object>} raw transfer method (contains `token` trm-…)
 */
export const createBankAccount = async (userToken, {
  branchId,            // ABA routing number
  bankAccountId,       // account number
  bankAccountPurpose = 'CHECKING',
  country,
  currency = 'USD'
}) => {
  const body = {
    transferMethodCountry: (country || process.env.DEFAULT_COUNTRY || 'US').toUpperCase().slice(0, 2),
    transferMethodCurrency: (currency || 'USD').toUpperCase(),
    type: 'BANK_ACCOUNT',
    branchId: String(branchId || '').trim(),
    bankAccountId: String(bankAccountId || '').trim(),
    bankAccountPurpose
  };
  const { ok, data } = await hyperwalletFetch(`/users/${userToken}/bank-accounts`, {
    method: 'POST',
    body
  });
  if (!ok || !data.token) {
    throw new Error(hyperwalletErrorMessage(data, 'Failed to add bank account'));
  }
  return data;
};

/**
 * Attach a PayPal transfer method to a Hyperwallet user.
 * @returns {Promise<object>} raw transfer method (contains `token` trm-…)
 */
export const createPaypalAccount = async (userToken, { email, country, currency = 'USD' }) => {
  const body = {
    transferMethodCountry: (country || process.env.DEFAULT_COUNTRY || 'US').toUpperCase().slice(0, 2),
    transferMethodCurrency: (currency || 'USD').toUpperCase(),
    type: 'PAYPAL_ACCOUNT',
    email: String(email || '').trim()
  };
  const { ok, data } = await hyperwalletFetch(`/users/${userToken}/paypal-accounts`, {
    method: 'POST',
    body
  });
  if (!ok || !data.token) {
    throw new Error(hyperwalletErrorMessage(data, 'Failed to add PayPal account'));
  }
  return data;
};

/** List all transfer methods (bank + PayPal) for a Hyperwallet user. */
export const listTransferMethods = async (userToken) => {
  const { ok, data } = await hyperwalletFetch(`/users/${userToken}/transfer-methods`);
  if (!ok) return [];
  return data?.data || [];
};

/** Permanently deactivate a bank-account transfer method. */
export const deactivateBankAccount = async (userToken, trmToken) => {
  const { ok, data } = await hyperwalletFetch(
    `/users/${userToken}/bank-accounts/${trmToken}/status-transitions`,
    { method: 'POST', body: { transition: 'DE_ACTIVATED' } }
  );
  if (!ok) throw new Error(hyperwalletErrorMessage(data, 'Failed to remove bank account'));
  return data;
};

/** Permanently deactivate a PayPal transfer method. */
export const deactivatePaypalAccount = async (userToken, trmToken) => {
  const { ok, data } = await hyperwalletFetch(
    `/users/${userToken}/paypal-accounts/${trmToken}/status-transitions`,
    { method: 'POST', body: { transition: 'DE_ACTIVATED' } }
  );
  if (!ok) throw new Error(hyperwalletErrorMessage(data, 'Failed to remove PayPal account'));
  return data;
};

/**
 * Create a payment (payout) to a transfer method.
 *
 * @param {object} args
 * @param {string} args.destinationToken  transfer method token (trm-…) or user token (usr-…)
 * @param {number} args.amount            amount in `currency` major units
 * @param {string} [args.currency=USD]
 * @param {string} args.clientPaymentId   unique idempotency id (our transaction id)
 * @param {string} [args.notes]
 * @param {string} [args.purpose=OTHER]
 * @returns {Promise<object>} raw payment (contains `token` pmt-… and `status`)
 */
export const createPayment = async ({
  destinationToken,
  amount,
  currency = 'USD',
  clientPaymentId,
  notes,
  purpose = 'OTHER'
}) => {
  const body = {
    programToken: getHyperwalletProgramToken(),
    clientPaymentId: String(clientPaymentId),
    destinationToken,
    amount: money(amount),
    currency: (currency || 'USD').toUpperCase(),
    purpose,
    notes: (notes || '').slice(0, 255) || undefined
  };
  const { ok, data } = await hyperwalletFetch('/payments', { method: 'POST', body });
  if (!ok || !data.token) {
    throw new Error(hyperwalletErrorMessage(data, 'Failed to create Hyperwallet payment'));
  }
  return data;
};

/** Retrieve a payment by token (used for status sync / reconciliation). */
export const getPayment = async (paymentToken) => {
  const { ok, data } = await hyperwalletFetch(`/payments/${paymentToken}`);
  if (!ok) throw new Error(hyperwalletErrorMessage(data, 'Failed to fetch Hyperwallet payment'));
  return data;
};

/**
 * Map a Hyperwallet payment status onto our internal payout lifecycle.
 *   completed → funds delivered
 *   failed    → return the held funds to the advisor
 *   processing→ keep holding, awaiting a terminal status
 */
export const mapPaymentStatus = (status) => {
  const s = String(status || '').toUpperCase();
  if (s === 'COMPLETED') return 'completed';
  if (['FAILED', 'CANCELLED', 'RETURNED', 'RECALLED', 'EXPIRED', 'UNCLAIMED'].includes(s)) {
    return 'failed';
  }
  return 'processing';
};
