import { paypalFetch } from '../config/paypal.js';
import { ZERO_DECIMAL_CURRENCIES } from '../utils/geo.js';

/**
 * PayPal Orders v2 helpers — the PayPal counterpart to the Stripe Checkout flow.
 *
 * Flow mirrors Stripe's "redirect + success route" approach:
 *   1. createOrder() → returns { orderId, approveUrl }; the app opens approveUrl.
 *   2. PayPal redirects the user to our return_url with ?token=<orderId>.
 *   3. captureOrder() finalizes the payment; we then credit/activate as usual.
 */

// PayPal expects amounts as decimal strings; zero-decimal currencies take no fraction.
const formatPaypalAmount = (amount, currency) => {
  const zero = ZERO_DECIMAL_CURRENCIES.has((currency || '').toUpperCase());
  const n = Number(amount) || 0;
  return zero ? String(Math.round(n)) : n.toFixed(2);
};

/**
 * Create a PayPal order.
 * @returns { orderId, approveUrl, raw }
 */
export const createPaypalOrder = async ({
  amount,
  currency,
  description,
  returnUrl,
  cancelUrl,
  referenceId
}) => {
  const value = formatPaypalAmount(amount, currency);
  const { ok, status, data } = await paypalFetch('/v2/checkout/orders', {
    method: 'POST',
    body: {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: referenceId ? String(referenceId) : undefined,
          description: (description || '').slice(0, 127),
          amount: {
            currency_code: (currency || 'USD').toUpperCase(),
            value
          }
        }
      ],
      application_context: {
        brand_name: 'Prophetic Pathway',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
        return_url: returnUrl,
        cancel_url: cancelUrl
      }
    }
  });

  if (!ok || !data.id) {
    throw new Error(`PayPal create order failed (${status}): ${data.message || 'unknown error'}`);
  }

  const approveUrl =
    (data.links || []).find((l) => l.rel === 'approve' || l.rel === 'payer-action')?.href || null;

  return { orderId: data.id, approveUrl, raw: data };
};

/**
 * Capture a previously-approved PayPal order (idempotent on PayPal's side).
 * @returns { paid, captureId, amount, currency, raw }
 */
export const capturePaypalOrder = async (orderId) => {
  if (!orderId) throw new Error('orderId required');

  // Inspect first so an already-captured order is treated as success, not an error.
  const look = await paypalFetch(`/v2/checkout/orders/${orderId}`);
  if (look.ok && look.data?.status === 'COMPLETED') {
    return parseCapture(look.data, true);
  }

  const { ok, status, data } = await paypalFetch(
    `/v2/checkout/orders/${orderId}/capture`,
    { method: 'POST' }
  );

  // 422 UNPROCESSABLE often means "already captured" — re-read and accept if completed.
  if (!ok) {
    const recheck = await paypalFetch(`/v2/checkout/orders/${orderId}`);
    if (recheck.ok && recheck.data?.status === 'COMPLETED') {
      return parseCapture(recheck.data, true);
    }
    throw new Error(`PayPal capture failed (${status}): ${data.message || 'unknown error'}`);
  }

  return parseCapture(data, data.status === 'COMPLETED');
};

const parseCapture = (order, paid) => {
  const pu = (order.purchase_units || [])[0] || {};
  const capture = (pu.payments?.captures || [])[0] || {};
  return {
    paid: Boolean(paid),
    captureId: capture.id || null,
    amount: Number(capture.amount?.value ?? pu.amount?.value ?? 0),
    currency: (capture.amount?.currency_code || pu.amount?.currency_code || '').toUpperCase(),
    raw: order
  };
};
