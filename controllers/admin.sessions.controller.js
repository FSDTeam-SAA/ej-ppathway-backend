import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import Session from '../models/session.model.js';
import { deleteRoom, stopEgress } from '../config/livekit.js';
import { refundToUserWallet } from '../services/session.service.js';
import Transaction from '../models/transaction.model.js';

export const listSessions = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = {};
  if (req.query.tab === 'live') filter.status = 'live';
  else if (req.query.tab === 'completed') filter.status = 'completed';
  else if (req.query.tab === 'cancelled') filter.status = 'cancelled';
  else if (req.query.tab === 'disputed') filter.status = 'disputed';
  else if (req.query.tab === 'flagged') filter.status = 'flagged';

  const total = await Session.countDocuments(filter);
  const items = await Session.find(filter)
    .populate('user', 'name profilePhoto')
    .populate('advisor', 'name profilePhoto')
    .sort({ createdAt: -1 }).skip(skip).limit(limit).lean();

  // overview counts
  const overview = await Session.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);

  return sendResponse(res, {
    data: items,
    meta: { ...buildMeta({ page, limit, total }), overview }
  });
});

// ============= Recordings list =============
export const listRecordings = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);

  const filter = {
    recordingUrl: { $exists: true, $nin: [null, ''] }
  };
  if (req.query.type && ['call', 'video'].includes(req.query.type)) {
    filter.type = req.query.type;
  }

  const total = await Session.countDocuments(filter);
  const items = await Session.find(filter)
    .select(
      'sessionCode type status user advisor recordingUrl actualDurationSec startedAt endedAt createdAt'
    )
    .populate('user', 'name profilePhoto email')
    .populate('advisor', 'name profilePhoto email')
    .sort({ endedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return sendResponse(res, {
    data: items,
    meta: buildMeta({ page, limit, total })
  });
});

export const getSession = catchAsync(async (req, res) => {
  const session = await Session.findById(req.params.id)
    .populate('user', 'name profilePhoto email')
    .populate('advisor', 'name profilePhoto email').lean();
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  return sendResponse(res, { data: session });
});

export const adminCancelSession = catchAsync(async (req, res) => {
  const { reason, refundUser = true } = req.body;
  const session = await Session.findById(req.params.id);
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  if (session.status === 'completed') throw new ApiError(StatusCodes.BAD_REQUEST, 'Cannot cancel a completed session');

  if (refundUser && (session.chargedAmount || 0) > 0) {
    await refundToUserWallet({ userId: session.user, amount: session.chargedAmount });
    await Transaction.create({
      type: 'session_refund',
      status: 'completed',
      user: session.user,
      session: session._id,
      amount: session.chargedAmount,
      description: `Admin cancellation refund for ${session.sessionCode}`
    });
    session.refundIssued = (session.refundIssued || 0) + session.chargedAmount;
    session.chargedAmount = 0;
  }

  session.status = 'cancelled';
  session.cancelReason = reason || 'Cancelled by admin';
  session.cancelledAt = new Date();
  session.cancelledBy = req.user._id;
  if (session.egressId) await stopEgress(session.egressId);
  if (session.livekitRoom) await deleteRoom(session.livekitRoom);
  await session.save();

  return sendResponse(res, { message: 'Session cancelled', data: session });
});

export const adminFlagSession = catchAsync(async (req, res) => {
  const session = await Session.findByIdAndUpdate(req.params.id, { status: 'flagged' }, { new: true });
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  return sendResponse(res, { data: session });
});

export const adminResolveDisputed = catchAsync(async (req, res) => {
  const session = await Session.findByIdAndUpdate(req.params.id, { status: 'completed' }, { new: true });
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  return sendResponse(res, { message: 'Marked as resolved', data: session });
});

export const adminDeleteSession = catchAsync(async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  if (session.status === 'live') throw new ApiError(StatusCodes.BAD_REQUEST, 'Cannot delete a live session');
  await session.deleteOne();
  return sendResponse(res, { message: 'Session deleted' });
});
