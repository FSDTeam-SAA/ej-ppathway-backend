import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import stripe from '../config/stripe.js';
import Plan from '../models/plan.model.js';
import UserSubscription from '../models/userSubscription.model.js';
import Transaction from '../models/transaction.model.js';
import User from '../models/user.model.js';
import { detectCountry } from '../utils/geo.js';
import { resolvePlanPrice, toProviderMinorUnits, getCurrencyForCountry } from '../services/pricing.service.js';
import { createPaypalOrder, capturePaypalOrder } from '../services/paypal.service.js';
import { isPaypalConfigured } from '../config/paypal.js';

// Persist the resolved country/currency back to the user so the next request is stable.
const rememberUserCurrency = async (userId, country, currency) => {
  if (!userId) return;
  try {
    await User.updateOne(
      { _id: userId },
      { $set: { country, currency } },
      { runValidators: false }
    );
  } catch (_e) {
    /* best-effort */
  }
};

// =========== Public listing (priced for the caller's country) ===========
export const listPlans = catchAsync(async (req, res) => {
  const country = detectCountry(req, { user: req.user });
  const cur = await getCurrencyForCountry(country);
  const plans = await Plan.find({ isActive: true }).sort({ sortOrder: 1, pricePerMonth: 1 }).lean();
  const localized = await Promise.all(
    plans.map(async (p) => ({ ...p, localizedPrice: await resolvePlanPrice(p, country) }))
  );
  if (req.user?._id) await rememberUserCurrency(req.user._id, cur.country, cur.currency);
  return sendResponse(res, {
    data: localized,
    meta: { country: cur.country, currency: cur.currency, symbol: cur.symbol }
  });
});

// =========== Get my subscription ===========
export const myActivePlan = catchAsync(async (req, res) => {
  const sub = await UserSubscription.findOne({ user: req.user._id, status: { $in: ['active', 'trialing'] } })
    .populate('plan').lean();
  return sendResponse(res, { data: sub });
});

// =========== Subscribe — Stripe or PayPal checkout (success route flow) ===========
export const subscribeToPlan = catchAsync(async (req, res) => {
  const { planId, tier } = req.body;
  const provider = (req.body.provider || 'stripe').toLowerCase();
  if (!planId && !tier) throw new ApiError(StatusCodes.BAD_REQUEST, 'planId or tier required');
  if (!['stripe', 'paypal'].includes(provider)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'provider must be "stripe" or "paypal"');
  }
  const plan = planId ? await Plan.findById(planId) : await Plan.findOne({ tier });
  if (!plan || !plan.isActive) throw new ApiError(StatusCodes.NOT_FOUND, 'Plan not found');

  // Resolve the price in the user's local currency (manual override or FX convert).
  const country = detectCountry(req, { user: req.user });
  const price = await resolvePlanPrice(plan, country);
  await rememberUserCurrency(req.user._id, price.country, price.currency);

  // Free plan — no payment provider needed
  if (!price.amount || price.amount === 0) {
    await UserSubscription.findOneAndUpdate(
      { user: req.user._id, status: { $in: ['active', 'trialing'] } },
      { status: 'cancelled', cancelledAt: new Date() }
    );
    const sub = await UserSubscription.create({
      user: req.user._id,
      plan: plan._id,
      planName: plan.name,
      status: 'active',
      startedAt: new Date(),
      renewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      pricePerMonth: 0,
      currency: price.currency,
      country: price.country,
      pricePerMonthUsd: 0,
      provider: 'internal'
    });
    return sendResponse(res, { message: 'Free plan activated', data: sub });
  }

  // create pending subscription record (shared by both providers)
  const pendingSub = await UserSubscription.create({
    user: req.user._id,
    plan: plan._id,
    planName: plan.name,
    status: 'pending',
    pricePerMonth: price.amount,
    currency: price.currency,
    country: price.country,
    pricePerMonthUsd: price.baseUsd,
    provider
  });

  // ---- PayPal branch ----
  if (provider === 'paypal') {
    if (!isPaypalConfigured()) throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'PayPal is not configured');
    const successBase =
      process.env.PAYPAL_SUBSCRIPTION_SUCCESS_URL ||
      (process.env.SERVER_URL + '/api/v1/subscriptions/paypal/success');
    const cancelBase =
      process.env.PAYPAL_SUBSCRIPTION_CANCEL_URL ||
      (process.env.SERVER_URL + '/api/v1/subscriptions/paypal/cancel');

    const order = await createPaypalOrder({
      amount: price.amount,
      currency: price.currency,
      description: `Subscription to ${plan.name}`,
      referenceId: pendingSub._id,
      returnUrl: `${successBase}?subId=${pendingSub._id}`,
      cancelUrl: `${cancelBase}?subId=${pendingSub._id}`
    });

    pendingSub.paypalOrderId = order.orderId;
    await pendingSub.save();

    return sendResponse(res, {
      data: {
        provider: 'paypal',
        checkoutUrl: order.approveUrl,
        orderId: order.orderId,
        subId: pendingSub._id,
        currency: price.currency,
        amount: price.amount
      }
    });
  }

  // ---- Stripe branch ----
  const user = await User.findById(req.user._id);
  if (!user.stripeCustomerId) {
    const customer = await stripe.customers.create({ email: user.email, name: user.name });
    user.stripeCustomerId = customer.id;
    await user.save();
  }

  const successBase =
    process.env.STRIPE_SUBSCRIPTION_SUCCESS_URL ||
    process.env.STRIPE_SUCCESS_URL ||
    (process.env.SERVER_URL + '/api/v1/subscriptions/checkout/success');
  const cancelBase =
    process.env.STRIPE_SUBSCRIPTION_CANCEL_URL ||
    process.env.STRIPE_CANCEL_URL ||
    (process.env.SERVER_URL + '/api/v1/subscriptions/checkout/cancel');
  const successUrl = `${successBase}?subId=${pendingSub._id}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${cancelBase}?subId=${pendingSub._id}`;

  // We use a simple "payment" mode for the first month and rely on success route to activate.
  // For production-grade recurring billing you'd typically use mode: 'subscription' + a Stripe Price.
  const checkout = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: user.stripeCustomerId,
    line_items: [
      {
        price_data: {
          currency: price.currency.toLowerCase(),
          unit_amount: toProviderMinorUnits(price.amount, price.currency),
          product_data: { name: plan.name }
        },
        quantity: 1
      }
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { type: 'subscription', subId: String(pendingSub._id), planId: String(plan._id) }
  });

  pendingSub.stripeCheckoutSessionId = checkout.id;
  await pendingSub.save();

  return sendResponse(res, {
    data: {
      provider: 'stripe',
      checkoutUrl: checkout.url,
      sessionId: checkout.id,
      subId: pendingSub._id,
      currency: price.currency,
      amount: price.amount
    }
  });
});

// Stripe success route (no webhook) for subscription
export const stripeSubscribeSuccess = catchAsync(async (req, res) => {
  const { subId, session_id } = req.query;
  if (!subId || !session_id) throw new ApiError(StatusCodes.BAD_REQUEST, 'Missing parameters');

  const sub = await UserSubscription.findById(subId);
  if (!sub) throw new ApiError(StatusCodes.NOT_FOUND, 'Subscription not found');
  if (sub.status === 'active') return sendResponse(res, { message: 'Already active', data: sub });

  const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['payment_intent'] });
  if (session.payment_status !== 'paid') {
    return sendResponse(res, {
      statusCode: StatusCodes.PAYMENT_REQUIRED,
      success: false,
      message: 'Payment not completed yet'
    });
  }

  // cancel any other active sub for this user
  await UserSubscription.updateMany(
    { user: sub.user, _id: { $ne: sub._id }, status: { $in: ['active', 'trialing'] } },
    { status: 'cancelled', cancelledAt: new Date() }
  );

  sub.status = 'active';
  sub.startedAt = new Date();
  sub.renewsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await sub.save();

  await Transaction.create({
    type: 'subscription',
    status: 'completed',
    provider: 'stripe',
    user: sub.user,
    amount: sub.pricePerMonth,
    currency: (sub.currency || 'usd').toLowerCase(),
    country: sub.country,
    amountUsd: sub.pricePerMonthUsd,
    subscription: sub._id,
    plan: sub.plan,
    description: `Subscription to ${sub.planName}`,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  });

  return sendResponse(res, { message: 'Subscription active', data: sub });
});

// =========== PayPal success/cancel routes for subscription ===========
export const paypalSubscribeSuccess = catchAsync(async (req, res) => {
  const subId = req.query.subId;
  const orderId = req.query.orderId || req.query.token; // PayPal returns ?token=<orderId>
  if (!subId) throw new ApiError(StatusCodes.BAD_REQUEST, 'Missing subId');

  const sub = await UserSubscription.findById(subId);
  if (!sub) throw new ApiError(StatusCodes.NOT_FOUND, 'Subscription not found');
  if (sub.status === 'active') return sendResponse(res, { message: 'Already active', data: sub });

  const capture = await capturePaypalOrder(orderId || sub.paypalOrderId);
  if (!capture.paid) {
    return sendResponse(res, {
      statusCode: StatusCodes.PAYMENT_REQUIRED,
      success: false,
      message: 'Payment not completed yet'
    });
  }

  await UserSubscription.updateMany(
    { user: sub.user, _id: { $ne: sub._id }, status: { $in: ['active', 'trialing'] } },
    { status: 'cancelled', cancelledAt: new Date() }
  );

  sub.status = 'active';
  sub.startedAt = new Date();
  sub.renewsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (capture.captureId) sub.paypalOrderId = sub.paypalOrderId || orderId;
  await sub.save();

  await Transaction.create({
    type: 'subscription',
    status: 'completed',
    provider: 'paypal',
    user: sub.user,
    amount: sub.pricePerMonth,
    currency: (sub.currency || capture.currency || 'usd').toLowerCase(),
    country: sub.country,
    amountUsd: sub.pricePerMonthUsd,
    subscription: sub._id,
    plan: sub.plan,
    description: `Subscription to ${sub.planName}`,
    paypalOrderId: orderId || sub.paypalOrderId,
    paypalCaptureId: capture.captureId
  });

  return sendResponse(res, { message: 'Subscription active', data: sub });
});

export const paypalSubscribeCancel = catchAsync(async (req, res) => {
  const { subId } = req.query;
  if (subId) {
    await UserSubscription.findByIdAndUpdate(subId, { status: 'cancelled', cancelledAt: new Date() });
  }
  return sendResponse(res, { message: 'Subscription checkout cancelled' });
});

export const stripeSubscribeCancel = catchAsync(async (req, res) => {
  const { subId } = req.query;
  if (subId) {
    await UserSubscription.findByIdAndUpdate(subId, { status: 'cancelled', cancelledAt: new Date() });
  }
  return sendResponse(res, { message: 'Subscription checkout cancelled' });
});

export const cancelMySubscription = catchAsync(async (req, res) => {
  const sub = await UserSubscription.findOneAndUpdate(
    { user: req.user._id, status: { $in: ['active', 'trialing'] } },
    { status: 'cancelled', cancelledAt: new Date() },
    { new: true }
  );
  return sendResponse(res, { message: 'Subscription cancelled', data: sub });
});
