import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import stripe from '../config/stripe.js';
import Plan from '../models/plan.model.js';
import UserSubscription from '../models/userSubscription.model.js';
import Transaction from '../models/transaction.model.js';
import User from '../models/user.model.js';

// =========== Public listing ===========
export const listPlans = catchAsync(async (_req, res) => {
  const plans = await Plan.find({ isActive: true }).sort({ sortOrder: 1, pricePerMonth: 1 }).lean();
  return sendResponse(res, { data: plans });
});

// =========== Get my subscription ===========
export const myActivePlan = catchAsync(async (req, res) => {
  const sub = await UserSubscription.findOne({ user: req.user._id, status: { $in: ['active', 'trialing'] } })
    .populate('plan').lean();
  return sendResponse(res, { data: sub });
});

// =========== Subscribe — Stripe checkout (success route flow) ===========
export const subscribeToPlan = catchAsync(async (req, res) => {
  const { planId } = req.body;
  const plan = await Plan.findById(planId);
  if (!plan || !plan.isActive) throw new ApiError(StatusCodes.NOT_FOUND, 'Plan not found');

  // Free plan — no Stripe needed
  if (!plan.pricePerMonth || plan.pricePerMonth === 0) {
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
      pricePerMonth: 0
    });
    return sendResponse(res, { message: 'Free plan activated', data: sub });
  }

  const user = await User.findById(req.user._id);
  if (!user.stripeCustomerId) {
    const customer = await stripe.customers.create({ email: user.email, name: user.name });
    user.stripeCustomerId = customer.id;
    await user.save();
  }

  // create pending subscription record
  const pendingSub = await UserSubscription.create({
    user: req.user._id,
    plan: plan._id,
    planName: plan.name,
    status: 'pending',
    pricePerMonth: plan.pricePerMonth
  });

  const successUrl = `${process.env.STRIPE_SUCCESS_URL || (process.env.SERVER_URL + '/api/v1/subscriptions/checkout/success')}?subId=${pendingSub._id}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${process.env.STRIPE_CANCEL_URL || (process.env.SERVER_URL + '/api/v1/subscriptions/checkout/cancel')}?subId=${pendingSub._id}`;

  // We use a simple "payment" mode for the first month and rely on success route to activate.
  // For production-grade recurring billing you'd typically use mode: 'subscription' + a Stripe Price.
  const checkout = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: user.stripeCustomerId,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(plan.pricePerMonth * 100),
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

  return sendResponse(res, { data: { checkoutUrl: checkout.url, sessionId: checkout.id, subId: pendingSub._id } });
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
    user: sub.user,
    amount: sub.pricePerMonth,
    subscription: sub._id,
    plan: sub.plan,
    description: `Subscription to ${sub.planName}`,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  });

  return sendResponse(res, { message: 'Subscription active', data: sub });
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
