import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import { uploadBufferToCloudinary } from '../services/upload.service.js';
import Dispute, { DISPUTE_TYPES, RESOLUTION_OPTIONS } from '../models/dispute.model.js';
import Session from '../models/session.model.js';
import Wallet from '../models/wallet.model.js';
import Transaction from '../models/transaction.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import { refundToUserWallet } from '../services/session.service.js';
import { createNotification } from '../services/notification.service.js';
import stripe from '../config/stripe.js';
import User from '../models/user.model.js';

const round2 = (n) => Math.round(n * 100) / 100;

const uploadDocs = async (files) => {
  if (!files || !files.length) return [];
  const urls = [];
  for (const f of files) {
    const r = await uploadBufferToCloudinary(f.buffer, 'dispute-docs', 'auto');
    urls.push(r.secure_url);
  }
  return urls;
};

// ===== Open dispute =====
export const openDispute = catchAsync(async (req, res) => {
  const { sessionId, disputeType, details, expectedResolution } = req.body;
  if (!DISPUTE_TYPES.includes(disputeType)) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid dispute type');
  if (!RESOLUTION_OPTIONS.includes(expectedResolution)) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid expected resolution');

  const session = await Session.findById(sessionId);
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  if (String(session.user) !== String(req.user._id)) throw new ApiError(StatusCodes.FORBIDDEN, 'Forbidden');

  const documents = await uploadDocs(req.files);

  const dispute = await Dispute.create({
    user: req.user._id,
    advisor: session.advisor,
    session: session._id,
    disputeType,
    details: details || '',
    expectedResolution,
    documents
  });

  // mark session as disputed
  if (session.status !== 'disputed') {
    session.status = 'disputed';
    await session.save();
  }

  return sendResponse(res, { statusCode: StatusCodes.CREATED, message: 'Dispute submitted', data: dispute });
});

// ===== User cancel their dispute =====
export const cancelDispute = catchAsync(async (req, res) => {
  const dispute = await Dispute.findById(req.params.id);
  if (!dispute) throw new ApiError(StatusCodes.NOT_FOUND, 'Dispute not found');
  if (String(dispute.user) !== String(req.user._id)) throw new ApiError(StatusCodes.FORBIDDEN, 'Forbidden');
  if (!['open', 'investigating'].includes(dispute.status))
    throw new ApiError(StatusCodes.BAD_REQUEST, `Cannot cancel dispute in status ${dispute.status}`);

  dispute.status = 'cancelled';
  await dispute.save();
  return sendResponse(res, { message: 'Dispute cancelled', data: dispute });
});

// ===== List disputes =====
export const listMyDisputes = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { user: req.user._id };
  if (req.query.status) filter.status = req.query.status;
  const total = await Dispute.countDocuments(filter);
  const items = await Dispute.find(filter)
    .populate('session', 'sessionCode type chargedAmount status')
    .populate('advisor', 'name profilePhoto')
    .sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

export const getDispute = catchAsync(async (req, res) => {
  const dispute = await Dispute.findById(req.params.id)
    .populate('session', 'sessionCode type chargedAmount status user advisor')
    .populate('user', 'name email profilePhoto')
    .populate('advisor', 'name email profilePhoto').lean();
  if (!dispute) throw new ApiError(StatusCodes.NOT_FOUND, 'Dispute not found');
  return sendResponse(res, { data: dispute });
});

// ===== Admin actions: investigate / resolve / reject =====
export const adminListDisputes = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) {
    const q = String(req.query.q).trim();
    const users = await User.find({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ]
    }).select('_id').lean();
    filter.$or = [
      { disputeType: { $regex: q, $options: 'i' } },
      { details: { $regex: q, $options: 'i' } },
      { user: { $in: users.map((u) => u._id) } },
      { advisor: { $in: users.map((u) => u._id) } }
    ];
  }
  const total = await Dispute.countDocuments(filter);
  const items = await Dispute.find(filter)
    .populate('user', 'name profilePhoto email')
    .populate('advisor', 'name profilePhoto email')
    .populate('session', 'sessionCode type chargedAmount')
    .sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

export const adminResolveDispute = catchAsync(async (req, res) => {
  const { resolution, refundAmount, note, reassignAdvisorId, freeRescheduleAt } = req.body;
  if (!RESOLUTION_OPTIONS.includes(resolution)) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid resolution');

  const dispute = await Dispute.findById(req.params.id);
  if (!dispute) throw new ApiError(StatusCodes.NOT_FOUND, 'Dispute not found');
  if (!['open', 'investigating'].includes(dispute.status)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Cannot resolve dispute in status ${dispute.status}`);
  }

  const session = await Session.findById(dispute.session);
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');

  if (resolution === 'full_refund' || resolution === 'partial_refund') {
    let amount = resolution === 'full_refund'
      ? round2(session.chargedAmount || 0)
      : round2(Number(refundAmount) || 0);

    if (amount <= 0) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid refund amount');
    if (amount > (session.chargedAmount || 0)) {
      amount = round2(session.chargedAmount || 0);
    }

    // refund into wallet
    await refundToUserWallet({ userId: session.user, amount });

    // Try Stripe refund if there is a paymentIntent linked from a topup we can't really refund per-session;
    // Refunds here happen in-app wallet. We track a transaction.
    await Transaction.create({
      type: 'session_refund',
      status: 'completed',
      user: session.user,
      advisor: session.advisor,
      session: session._id,
      amount,
      description: `Dispute refund for session ${session.sessionCode}`
    });

    // Reverse advisor earnings proportional
    const advisorWallet = await Wallet.findOne({ user: session.advisor });
    if (advisorWallet) {
      const reverse = Math.min(advisorWallet.earningsBalance, round2(session.advisorPayout || amount * 0.8));
      if (reverse > 0) {
        advisorWallet.earningsBalance = round2(advisorWallet.earningsBalance - reverse);
        await advisorWallet.save();
        await Transaction.create({
          type: 'advisor_earning',
          status: 'refunded',
          user: session.user,
          advisor: session.advisor,
          session: session._id,
          amount: -reverse,
          description: `Earnings reversed due to dispute refund on ${session.sessionCode}`
        });
      }
    }
    // refund stats
    await AdvisorProfile.findOneAndUpdate(
      { user: session.advisor },
      { $inc: { refundRate: 1 } } // simple counter; UI can derive %
    );

    dispute.refundAmount = amount;
    session.refundIssued = round2((session.refundIssued || 0) + amount);
  } else if (resolution === 'free_reschedule') {
    if (!freeRescheduleAt) throw new ApiError(StatusCodes.BAD_REQUEST, 'freeRescheduleAt required');
    const newSession = await Session.create({
      user: session.user,
      advisor: session.advisor,
      type: session.type,
      ratePerMin: 0, // free reschedule
      durationMinutes: session.durationMinutes,
      scheduledFor: new Date(freeRescheduleAt),
      estimatedCost: 0,
      status: 'pending'
    });
    dispute.rescheduleSessionId = newSession._id;
  } else if (resolution === 'assign_another_advisor') {
    if (!reassignAdvisorId) throw new ApiError(StatusCodes.BAD_REQUEST, 'reassignAdvisorId required');
    const newSession = await Session.create({
      user: session.user,
      advisor: reassignAdvisorId,
      type: session.type,
      ratePerMin: session.ratePerMin,
      durationMinutes: session.durationMinutes,
      scheduledFor: new Date(Date.now() + 24 * 60 * 60 * 1000),
      estimatedCost: session.estimatedCost,
      status: 'pending'
    });
    dispute.rescheduleSessionId = newSession._id;
    dispute.reassignedAdvisor = reassignAdvisorId;
  }

  dispute.status = 'resolved';
  dispute.resolutionApplied = resolution;
  dispute.resolutionNote = note || '';
  dispute.resolvedBy = req.user._id;
  dispute.resolvedAt = new Date();
  await dispute.save();

  // mark session: keep as disputed but record resolution
  await session.save();

  await createNotification({
    recipient: session.user,
    type: 'payment_update',
    title: 'Dispute resolved',
    body: `Your dispute has been resolved: ${resolution}`,
    data: { disputeId: dispute._id }
  });

  return sendResponse(res, { message: 'Dispute resolved', data: dispute });
});

export const adminRejectDispute = catchAsync(async (req, res) => {
  const { note } = req.body;
  const dispute = await Dispute.findByIdAndUpdate(
    req.params.id,
    { status: 'rejected', resolutionNote: note || '', resolvedBy: req.user._id, resolvedAt: new Date() },
    { new: true }
  );
  if (!dispute) throw new ApiError(StatusCodes.NOT_FOUND, 'Dispute not found');

  await createNotification({
    recipient: dispute.user,
    type: 'payment_update',
    title: 'Dispute rejected',
    body: note || 'Your dispute was rejected.',
    data: { disputeId: dispute._id }
  });

  return sendResponse(res, { message: 'Dispute rejected', data: dispute });
});

export const adminMarkInvestigating = catchAsync(async (req, res) => {
  const dispute = await Dispute.findByIdAndUpdate(req.params.id, { status: 'investigating' }, { new: true });
  if (!dispute) throw new ApiError(StatusCodes.NOT_FOUND, 'Dispute not found');
  return sendResponse(res, { data: dispute });
});
