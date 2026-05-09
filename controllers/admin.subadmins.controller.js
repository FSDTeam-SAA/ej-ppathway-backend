import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import User, { SUB_ADMIN_PERMISSIONS } from '../models/user.model.js';

export const listSubAdmins = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { role: 'sub_admin' };
  if (req.query.q) {
    filter.$or = [
      { name: { $regex: req.query.q, $options: 'i' } },
      { email: { $regex: req.query.q, $options: 'i' } }
    ];
  }
  const total = await User.countDocuments(filter);
  const items = await User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

export const getPermissionsList = catchAsync(async (_req, res) => {
  return sendResponse(res, { data: SUB_ADMIN_PERMISSIONS });
});

export const createSubAdmin = catchAsync(async (req, res) => {
  const { name, email, phoneNumber, password, role, permissions = [] } = req.body;
  if (!name || !email || !password) throw new ApiError(StatusCodes.BAD_REQUEST, 'Missing required fields');

  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) throw new ApiError(StatusCodes.CONFLICT, 'Email already in use');

  // validate permissions
  const validPerms = permissions.filter((p) => SUB_ADMIN_PERMISSIONS.includes(p));

  const user = await User.create({
    name,
    email: email.toLowerCase(),
    phone: phoneNumber,
    password,
    role: 'sub_admin',
    permissions: validPerms,
    status: 'active',
    isVerified: true,
    location: role || ''
  });
  return sendResponse(res, { statusCode: StatusCodes.CREATED, data: user });
});

export const updateSubAdmin = catchAsync(async (req, res) => {
  const { name, phoneNumber, permissions, password } = req.body;
  const user = await User.findOne({ _id: req.params.id, role: 'sub_admin' }).select('+password');
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Sub-admin not found');

  if (name) user.name = name;
  if (phoneNumber) user.phone = phoneNumber;
  if (permissions) user.permissions = permissions.filter((p) => SUB_ADMIN_PERMISSIONS.includes(p));
  if (password) user.password = password;

  await user.save();
  return sendResponse(res, { data: user });
});

export const suspendSubAdmin = catchAsync(async (req, res) => {
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'sub_admin' },
    { status: 'suspended', suspendedAt: new Date() },
    { new: true }
  );
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Sub-admin not found');
  return sendResponse(res, { message: 'Sub-admin suspended', data: user });
});

export const unsuspendSubAdmin = catchAsync(async (req, res) => {
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'sub_admin' },
    { status: 'active', suspendedAt: null },
    { new: true }
  );
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Sub-admin not found');
  return sendResponse(res, { data: user });
});

export const deleteSubAdmin = catchAsync(async (req, res) => {
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'sub_admin' },
    { status: 'deactivated' },
    { new: true }
  );
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Sub-admin not found');
  return sendResponse(res, { message: 'Sub-admin deactivated' });
});
