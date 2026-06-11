import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import User from '../models/user.model.js';
import AdminActivity from '../models/adminActivity.model.js';
import { logAdminActivity } from '../services/activity.service.js';
import {
  PERMISSION_GROUPS,
  ALL_PERMISSIONS,
  ROLE_PRESETS,
  resolvePermissions
} from '../config/subAdminPermissions.js';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export const listSubAdmins = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { role: 'sub_admin' };
  if (req.query.q) {
    filter.$or = [
      { name: { $regex: req.query.q, $options: 'i' } },
      { email: { $regex: req.query.q, $options: 'i' } },
      { phone: { $regex: req.query.q, $options: 'i' } }
    ];
  }
  if (req.query.role) filter.roleKey = req.query.role;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }

  const total = await User.countDocuments(filter);
  const items = await User.find(filter)
    .populate('createdBy', 'name email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const data = items.map((u) => ({
    ...u,
    isOnline: u.lastActiveAt ? Date.now() - new Date(u.lastActiveAt).getTime() < ONLINE_WINDOW_MS : false
  }));

  return sendResponse(res, { data, meta: buildMeta({ page, limit, total }) });
});

export const getPermissionsList = catchAsync(async (_req, res) => {
  const roles = Object.entries(ROLE_PRESETS).map(([key, v]) => ({
    key,
    label: v.label,
    description: v.description,
    permissions: v.permissions
  }));
  return sendResponse(res, {
    data: { groups: PERMISSION_GROUPS, permissions: ALL_PERMISSIONS, roles }
  });
});

export const getSubAdmin = catchAsync(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: 'sub_admin' })
    .populate('createdBy', 'name email')
    .lean();
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Sub-admin not found');

  const recentActivity = await AdminActivity.find({ admin: user._id })
    .populate('targetUser', 'name email role')
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  const isOnline = user.lastActiveAt
    ? Date.now() - new Date(user.lastActiveAt).getTime() < ONLINE_WINDOW_MS
    : false;

  return sendResponse(res, {
    data: { ...user, isOnline, recentActivity, roleLabel: ROLE_PRESETS[user.roleKey]?.label || user.location || '—' }
  });
});

// Activity log with filters: date range, action type, affected user/advisor.
export const listSubAdminActivity = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { admin: req.params.id };
  if (req.query.action) filter.action = req.query.action;
  if (req.query.targetType) filter.targetType = req.query.targetType;
  if (req.query.targetUser) filter.targetUser = req.query.targetUser;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }

  const total = await AdminActivity.countDocuments(filter);
  const items = await AdminActivity.find(filter)
    .populate('targetUser', 'name email role')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

export const createSubAdmin = catchAsync(async (req, res) => {
  const { name, email, phoneNumber, password, role, jobTitle, permissions = [] } = req.body;
  if (!name || !email || !password) throw new ApiError(StatusCodes.BAD_REQUEST, 'Missing required fields');

  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) throw new ApiError(StatusCodes.CONFLICT, 'Email already in use');

  const roleKey = role && ROLE_PRESETS[role] ? role : 'custom';
  const effectivePerms = resolvePermissions(roleKey, permissions);

  const user = await User.create({
    name,
    email: email.toLowerCase(),
    phone: phoneNumber,
    password,
    role: 'sub_admin',
    roleKey,
    jobTitle: jobTitle || '',
    permissions: effectivePerms,
    status: 'active',
    isVerified: true,
    location: ROLE_PRESETS[roleKey]?.label || role || '',
    createdBy: req.user?._id
  });

  await logAdminActivity({
    adminId: req.user?._id,
    action: 'subadmin.create',
    description: `Created sub-admin ${user.name} (${ROLE_PRESETS[roleKey]?.label || roleKey})`,
    targetType: 'sub_admin',
    targetUser: user._id
  });

  return sendResponse(res, { statusCode: StatusCodes.CREATED, data: user });
});

export const updateSubAdmin = catchAsync(async (req, res) => {
  const { name, phoneNumber, jobTitle, role, permissions, password } = req.body;
  const user = await User.findOne({ _id: req.params.id, role: 'sub_admin' }).select('+password');
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Sub-admin not found');

  if (name) user.name = name;
  if (phoneNumber !== undefined) user.phone = phoneNumber;
  if (jobTitle !== undefined) user.jobTitle = jobTitle;
  if (role && ROLE_PRESETS[role]) {
    user.roleKey = role;
    user.location = ROLE_PRESETS[role].label;
    // For preset roles the permissions follow the role; custom keeps explicit list.
    user.permissions = resolvePermissions(role, permissions ?? user.permissions);
  } else if (permissions) {
    user.permissions = (permissions || []).filter((p) => ALL_PERMISSIONS.includes(p));
  }
  if (password) user.password = password;

  await user.save();

  await logAdminActivity({
    adminId: req.user?._id,
    action: 'subadmin.update',
    description: `Updated sub-admin ${user.name}`,
    targetType: 'sub_admin',
    targetUser: user._id
  });

  return sendResponse(res, { data: user });
});

export const suspendSubAdmin = catchAsync(async (req, res) => {
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'sub_admin' },
    { status: 'suspended', suspendedAt: new Date() },
    { new: true }
  );
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Sub-admin not found');
  await logAdminActivity({
    adminId: req.user?._id,
    action: 'subadmin.suspend',
    description: `Suspended sub-admin ${user.name}`,
    targetType: 'sub_admin',
    targetUser: user._id
  });
  return sendResponse(res, { message: 'Sub-admin suspended', data: user });
});

export const unsuspendSubAdmin = catchAsync(async (req, res) => {
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'sub_admin' },
    { status: 'active', suspendedAt: null },
    { new: true }
  );
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Sub-admin not found');
  await logAdminActivity({
    adminId: req.user?._id,
    action: 'subadmin.reactivate',
    description: `Reactivated sub-admin ${user.name}`,
    targetType: 'sub_admin',
    targetUser: user._id
  });
  return sendResponse(res, { data: user });
});

export const deleteSubAdmin = catchAsync(async (req, res) => {
  // Hard delete so the account leaves the list (consistent with users/advisors).
  const user = await User.findOneAndDelete({ _id: req.params.id, role: 'sub_admin' });
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Sub-admin not found');
  await logAdminActivity({
    adminId: req.user?._id,
    action: 'subadmin.delete',
    description: `Removed sub-admin ${user.name}`,
    targetType: 'sub_admin'
  });
  return sendResponse(res, { message: 'Sub-admin removed' });
});
