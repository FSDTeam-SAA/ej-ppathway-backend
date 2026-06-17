import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import User from '../models/user.model.js';
import Wallet from '../models/wallet.model.js';
import Session from '../models/session.model.js';
import Transaction from '../models/transaction.model.js';
import UserSubscription from '../models/userSubscription.model.js';
import AdminActivity from '../models/adminActivity.model.js';
import { createNotification } from '../services/notification.service.js';
import { logAdminActivity } from '../services/activity.service.js';

export const listUsers = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { role: 'user' };
  if (req.query.q) {
    filter.$or = [
      { name: { $regex: req.query.q, $options: 'i' } },
      { email: { $regex: req.query.q, $options: 'i' } }
    ];
  }
  if (req.query.status) filter.status = req.query.status;

  const total = await User.countDocuments(filter);
  const users = await User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();

  // pull wallet + subscription
  const ids = users.map((u) => u._id);
  const wallets = await Wallet.find({ user: { $in: ids } }).lean();
  const wmap = new Map(wallets.map((w) => [String(w.user), w]));
  const subs = await UserSubscription.find({ user: { $in: ids }, status: 'active' }).lean();
  const smap = new Map(subs.map((s) => [String(s.user), s]));
  const sessions = await Session.aggregate([
    { $match: { user: { $in: ids } } },
    { $group: { _id: '$user', count: { $sum: 1 }, payments: { $sum: '$chargedAmount' } } }
  ]);
  const sessMap = new Map(sessions.map((s) => [String(s._id), s]));

  const data = users.map((u) => ({
    ...u,
    wallet: wmap.get(String(u._id)) || null,
    activeSubscription: smap.get(String(u._id)) || null,
    sessionsCount: sessMap.get(String(u._id))?.count || 0,
    payments: sessMap.get(String(u._id))?.payments || 0
  }));

  // pending booking sessions (admin dashboard widget)
  const pendingBookings = await Session.countDocuments({ status: 'pending' });

  return sendResponse(res, {
    data,
    meta: { ...buildMeta({ page, limit, total }), pendingBookings }
  });
});

export const getUserDetails = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');

  const wallet = await Wallet.findOne({ user: user._id });
  const sessionsCount = await Session.countDocuments({ user: user._id });
  const totalSpentAgg = await Transaction.aggregate([
    { $match: { user: user._id, status: 'completed', type: { $in: ['session_charge','wallet_topup','tip','subscription','unlock_recording','unlock_transcript'] } } },
    { $group: { _id: null, t: { $sum: '$amount' } } }
  ]);
  const sub = await UserSubscription.findOne({ user: user._id, status: 'active' }).populate('plan');
  const subscriptions = await UserSubscription.find({ user: user._id })
    .populate('plan')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  const recentTransactions = await Transaction.find({ user: user._id })
    .populate('advisor', 'name email profilePhoto')
    .populate('plan', 'name')
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
  const refunds = recentTransactions.filter((t) => ['session_refund', 'subscription_refund'].includes(t.type));
  const adminActivity = await AdminActivity.find({ targetUser: user._id })
    .populate('admin', 'name email')
    .sort({ createdAt: -1 })
    .limit(15)
    .lean();

  const recentSessions = await Session.find({ user: user._id })
    .populate('advisor', 'name profilePhoto')
    .sort({ createdAt: -1 }).limit(20).lean();

  return sendResponse(res, {
    data: {
      user,
      wallet,
      sessionsCount,
      totalSpent: totalSpentAgg[0]?.t || 0,
      activeSubscription: sub,
      subscriptions,
      recentTransactions,
      refunds,
      adminActivity,
      recentSessions
    }
  });
});

export const giveFreeCredits = catchAsync(async (req, res) => {
  const { amount } = req.body;
  const value = Number(amount);
  if (!value || value <= 0) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid amount');

  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');

  const wallet = await Wallet.findOneAndUpdate(
    { user: user._id },
    { $inc: { freeCredits: value } },
    { new: true, upsert: true }
  );

  await Transaction.create({
    type: 'free_credit_grant',
    status: 'completed',
    user: user._id,
    amount: value,
    description: `Admin granted $${value} in free credits`
  });

  await createNotification({
    recipient: user._id,
    type: 'free_credits_granted',
    title: 'Free credits added',
    body: `You received $${value} in free credits`,
    data: { amount: value }
  });

  await logAdminActivity({
    adminId: req.user?._id,
    action: 'wallet.credit',
    description: `Issued $${value} wallet credit to ${user.name}`,
    targetType: 'user',
    targetUser: user._id
  });

  return sendResponse(res, { message: 'Credits granted', data: wallet });
});

export const suspendUser = catchAsync(async (req, res) => {
  const { reason } = req.body;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { status: 'suspended', suspendedReason: reason || '', suspendedAt: new Date() },
    { new: true }
  );
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  await logAdminActivity({
    adminId: req.user?._id,
    action: 'user.suspend',
    description: `Suspended user ${user.name}`,
    targetType: 'user',
    targetUser: user._id
  });
  return sendResponse(res, { message: 'User suspended', data: user });
});

export const unsuspendUser = catchAsync(async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { status: 'active', suspendedReason: null, suspendedAt: null },
    { new: true }
  );
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  return sendResponse(res, { message: 'User unsuspended', data: user });
});

export const adminResetUserPassword = catchAsync(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) throw new ApiError(StatusCodes.BAD_REQUEST, 'Password too short');
  const user = await User.findById(req.params.id).select('+password');
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  user.password = newPassword;
  // Force the user to set their own password on next login.
  user.mustChangePassword = true;
  await user.save();
  // Notify the user that their password was reset by an admin.
  await createNotification({
    recipient: user._id,
    type: 'admin_announcement',
    title: 'Your password was reset',
    body: 'An administrator reset your password. You will be asked to set a new password the next time you log in.'
  });
  return sendResponse(res, { message: 'Password reset' });
});

export const deleteUser = catchAsync(async (req, res) => {
  // Hard delete: actually remove the account so it disappears from the user list.
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  // Remove the user's owned wallet too; historical session/transaction records
  // are retained for reporting integrity.
  await Wallet.deleteOne({ user: user._id });
  return sendResponse(res, { message: 'User deleted' });
});
