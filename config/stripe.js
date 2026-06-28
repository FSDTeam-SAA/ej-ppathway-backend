import Stripe from 'stripe';

let _stripe = null;

const getStripe = () => {
  if (_stripe) return _stripe;
  const rawKey = process.env.STRIPE_SECRET_KEY;
  const key = rawKey?.trim().replace(/^['"]|['"]$/g, '');
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  if (key.includes('replace') || !/^sk_(test|live)_/.test(key)) {
    throw new Error('STRIPE_SECRET_KEY is invalid. Use a real Stripe secret key (sk_test_... or sk_live_...).');
  }
  _stripe = new Stripe(key, { apiVersion: '2026-02-25.clover' });
  return _stripe;
};

// Proxy: lazy-evaluate every property access so the client is created on first use
const stripe = new Proxy(
  {},
  {
    get: (_t, prop) => {
      const client = getStripe();
      const v = client[prop];
      return typeof v === 'function' ? v.bind(client) : v;
    }
  }
);

export default stripe;
