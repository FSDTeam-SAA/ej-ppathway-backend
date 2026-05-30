import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import Notification from '../models/notification.model.js';
import User from '../models/user.model.js';
import { createNotification } from '../services/notification.service.js';

export const listMyNotifications = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { recipient: req.user._id };
  if (req.query.unread === 'true') filter.read = false;
  const total = await Notification.countDocuments(filter);
  const items = await Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();

  // group "New" (today) vs "Earlier"
  const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
  const isNew = (n) => new Date(n.createdAt) >= startOfDay;
  const grouped = {
    new: items.filter(isNew),
    earlier: items.filter((n) => !isNew(n))
  };

  return sendResponse(res, {
    data: { items, grouped },
    meta: buildMeta({ page, limit, total })
  });
});

export const myNotificationSummary = catchAsync(async (req, res) => {
  const [total, unread] = await Promise.all([
    Notification.countDocuments({ recipient: req.user._id }),
    Notification.countDocuments({ recipient: req.user._id, read: false })
  ]);

  return sendResponse(res, { data: { total, unread } });
});

export const markAsRead = catchAsync(async (req, res) => {
  const n = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.user._id },
    { read: true, readAt: new Date() },
    { new: true }
  );
  if (!n) throw new ApiError(StatusCodes.NOT_FOUND, 'Notification not found');
  return sendResponse(res, { data: n });
});

export const markAllRead = catchAsync(async (req, res) => {
  await Notification.updateMany({ recipient: req.user._id, read: false }, { read: true, readAt: new Date() });
  return sendResponse(res, { message: 'All notifications marked as read' });
});

export const deleteNotification = catchAsync(async (req, res) => {
  const n = await Notification.findOneAndDelete({ _id: req.params.id, recipient: req.user._id });
  if (!n) throw new ApiError(StatusCodes.NOT_FOUND, 'Notification not found');
  return sendResponse(res, { message: 'Deleted' });
});

export const bulkDeleteNotifications = catchAsync(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (ids.length === 0) throw new ApiError(StatusCodes.BAD_REQUEST, 'ids array is required');
  const result = await Notification.deleteMany({ _id: { $in: ids }, recipient: req.user._id });
  return sendResponse(res, { message: `Deleted ${result.deletedCount}`, data: { deletedCount: result.deletedCount } });
});

// Admin broadcast
export const adminBroadcast = catchAsync(async (req, res) => {
  const { audience = 'all', title, body, data } = req.body;
  if (!title) throw new ApiError(StatusCodes.BAD_REQUEST, 'title required');
  const filter = {};
  if (audience === 'users') filter.role = 'user';
  else if (audience === 'advisors') filter.role = 'advisor';

  const recipients = await User.find(filter).select('_id').lean();
  const docs = recipients.map((r) => ({
    recipient: r._id,
    type: 'admin_announcement',
    title,
    body: body || '',
    data
  }));
  if (docs.length) await Notification.insertMany(docs);
  return sendResponse(res, { message: `Broadcast to ${docs.length} recipients` });
});
