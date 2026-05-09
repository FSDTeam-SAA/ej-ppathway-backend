import Stripe from 'stripe';

let _stripe = null;

const getStripe = () => {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  _stripe = new Stripe(key, { apiVersion: '2024-11-20.acacia' });
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
