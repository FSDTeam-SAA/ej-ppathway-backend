import { StatusCodes } from 'http-status-codes';
import mongoose from 'mongoose';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import Session from '../models/session.model.js';
import Chat from '../models/chat.model.js';
import Message from '../models/message.model.js';
import { deleteRoom, stopEgress } from '../config/livekit.js';
import { refundToUserWallet } from '../services/session.service.js';
import Transaction from '../models/transaction.model.js';
import User from '../models/user.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import { buildChatTranscriptPdf } from '../services/chatTranscriptPdf.service.js';

const MAX_TRANSCRIPT_MESSAGES = 10_000;
const TRANSCRIPT_READY_STATUSES = ['completed', 'cancelled', 'expired', 'no_show', 'flagged', 'disputed'];

const requireTranscriptPermission = (user) => {
  if (user.role === 'admin') return;
  const permissions = user.permissions || [];
  if (!permissions.includes('*') && !permissions.includes('recordings.transcripts')) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Insufficient transcript permissions');
  }
};

const requireRecordingsViewPermission = (user) => {
  if (user.role === 'admin') return;
  const permissions = user.permissions || [];
  if (!permissions.includes('*') && !permissions.includes('recordings.view')) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Insufficient recording permissions');
  }
};

const transcriptFilename = (session) => {
  const reference = String(session.sessionCode || session._id)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 80);
  return `session-chat-transcript-${reference || 'session'}.pdf`;
};

const userIdsForQuery = async (q, roles = []) => {
  if (!q) return [];
  const filter = {
    $or: [
      { name: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } }
    ]
  };
  if (roles.length) filter.role = { $in: roles };
  const users = await User.find(filter).select('_id').lean();
  return users.map((u) => u._id);
};

export const listSessions = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = {};
  if (req.query.tab === 'live') filter.status = 'live';
  else if (req.query.tab === 'completed') filter.status = 'completed';
  else if (req.query.tab === 'cancelled') filter.status = 'cancelled';
  else if (req.query.tab === 'disputed') filter.status = 'disputed';
  else if (req.query.tab === 'flagged') filter.status = 'flagged';

  if (['chat', 'call', 'video'].includes(req.query.type)) {
    filter.type = req.query.type;
  }

  if (['today', 'week', 'month'].includes(req.query.period)) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    if (req.query.period === 'week') start.setDate(start.getDate() - start.getDay());
    if (req.query.period === 'month') start.setDate(1);
    filter.createdAt = { $gte: start };
  }

  if (['silver', 'gold', 'platinum'].includes(req.query.tier)) {
    const profiles = await AdvisorProfile.find({ tier: req.query.tier }).select('user').lean();
    filter.advisor = { $in: profiles.map((p) => p.user) };
  }

  if (req.query.q) {
    const q = String(req.query.q).trim();
    const ids = await userIdsForQuery(q, ['user', 'advisor']);
    filter.$or = [
      { sessionCode: { $regex: q, $options: 'i' } },
      { user: { $in: ids } },
      { advisor: { $in: ids } }
    ];
  }

  const total = await Session.countDocuments(filter);
  const items = await Session.find(filter)
    .populate('user', 'name profilePhoto')
    .populate('advisor', 'name profilePhoto')
    .sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
  const advisorIds = [...new Set(items.map((s) => String(s.advisor?._id || s.advisor)).filter(Boolean))];
  const profiles = advisorIds.length
    ? await AdvisorProfile.find({ user: { $in: advisorIds } }).select('user tier').lean()
    : [];
  const tierMap = new Map(profiles.map((p) => [String(p.user), p.tier]));
  const data = items.map((s) => ({
    ...s,
    advisorTier: tierMap.get(String(s.advisor?._id || s.advisor)) || ''
  }));

  // overview counts
  const overview = await Session.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);

  return sendResponse(res, {
    data,
    meta: { ...buildMeta({ page, limit, total }), overview }
  });
});

// ============= Recordings + chat transcripts list =============
// The Session Recordings page is the central repository for all session
// communications: video recordings, voice recordings AND text chat transcripts.
// type = video | voice | chat | (all)
const CHAT_DONE_STATUSES = ['completed', 'disputed', 'flagged', 'cancelled'];
const MEDIA_DONE_STATUSES = ['completed', 'disputed', 'flagged', 'cancelled'];

export const listRecordings = catchAsync(async (req, res) => {
  requireRecordingsViewPermission(req.user);
  const { skip, limit, page } = parsePagination(req.query);
  const type = req.query.type;

  const hasRecording = { recordingUrl: { $exists: true, $nin: [null, ''] } };
  const chatMatch = { type: 'chat', status: { $in: CHAT_DONE_STATUSES } };

  let filter;
  if (type === 'video') {
    filter = { type: 'video', status: { $in: MEDIA_DONE_STATUSES } };
  } else if (type === 'voice' || type === 'call') {
    filter = { type: 'call', status: { $in: MEDIA_DONE_STATUSES } };
  } else if (type === 'chat') {
    filter = chatMatch;
  } else {
    // all: every finished media session, plus every text-chat session. Some
    // media rows may still be processing when the webhook has not attached the
    // final recordingUrl yet; keep them visible instead of hiding the session.
    filter = {
      $or: [
        { type: { $in: ['call', 'video'] }, status: { $in: MEDIA_DONE_STATUSES } },
        chatMatch,
        hasRecording
      ]
    };
  }

  if (req.query.q) {
    const q = String(req.query.q).trim();
    const ids = await userIdsForQuery(q, ['user', 'advisor']);
    const search = {
      $or: [
        { sessionCode: { $regex: q, $options: 'i' } },
        { user: { $in: ids } },
        { advisor: { $in: ids } }
      ]
    };
    filter = filter.$and ? { ...filter, $and: filter.$and.concat(search) } : { $and: [filter, search] };
  }

  const total = await Session.countDocuments(filter);
  const items = await Session.find(filter)
    .select(
      'sessionCode type status user advisor recordingUrl recordingStatus recordingError transcriptUrl actualDurationSec startedAt endedAt createdAt'
    )
    .populate('user', 'name profilePhoto email')
    .populate('advisor', 'name profilePhoto email')
    .sort({ endedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  // Flag which chat sessions actually carry a transcript (have messages).
  const chatSessionIds = items.filter((s) => s.type === 'chat').map((s) => s._id);
  const transcriptMap = new Map();
  if (chatSessionIds.length) {
    const chats = await Chat.find({ session: { $in: chatSessionIds }, kind: 'session' })
      .select('_id session')
      .lean();
    if (chats.length) {
      const counts = await Message.aggregate([
        { $match: { chat: { $in: chats.map((c) => c._id) } } },
        { $group: { _id: '$chat', count: { $sum: 1 } } }
      ]);
      const countByChat = new Map(counts.map((c) => [String(c._id), c.count]));
      chats.forEach((c) =>
        transcriptMap.set(String(c.session), countByChat.get(String(c._id)) || 0)
      );
    }
  }

  const data = items.map((s) => ({
    ...s,
    messageCount: s.type === 'chat' ? transcriptMap.get(String(s._id)) || 0 : 0,
    hasTranscript:
      s.type === 'chat' ? (transcriptMap.get(String(s._id)) || 0) > 0 : !!s.transcriptUrl
  }));

  return sendResponse(res, {
    data,
    meta: buildMeta({ page, limit, total })
  });
});

// Full chat conversation for a session — viewed / downloaded from the dashboard.
export const getSessionTranscript = catchAsync(async (req, res) => {
  requireTranscriptPermission(req.user);
  const session = await Session.findById(req.params.id)
    .populate('user', 'name profilePhoto email')
    .populate('advisor', 'name profilePhoto email')
    .lean();
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');

  const chat = await Chat.findOne({ session: session._id, kind: 'session' }).lean();
  let messages = [];
  if (chat) {
    messages = await Message.find({ chat: chat._id })
      .populate('sender', 'name profilePhoto')
      .sort({ createdAt: 1 })
      .lean();
  }

  return sendResponse(res, { data: { session, chatId: chat?._id || null, messages } });
});

export const downloadSessionTranscriptPdf = catchAsync(async (req, res) => {
  requireTranscriptPermission(req.user);
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid session ID');
  }
  const session = await Session.findById(req.params.id)
    .populate('user', 'name')
    .populate('advisor', 'name');
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  if (session.type !== 'chat') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Only text sessions have chat transcripts');
  }
  if (!TRANSCRIPT_READY_STATUSES.includes(session.status)) {
    throw new ApiError(StatusCodes.CONFLICT, 'The transcript is available after the session ends');
  }

  const chat = await Chat.findOne({ session: session._id, kind: 'session' }).lean();
  let messages = [];
  if (chat) {
    const total = await Message.countDocuments({ chat: chat._id });
    if (total > MAX_TRANSCRIPT_MESSAGES) {
      throw new ApiError(
        StatusCodes.REQUEST_TOO_LONG,
        `This transcript exceeds the ${MAX_TRANSCRIPT_MESSAGES}-message export limit`
      );
    }
    messages = await Message.find({ chat: chat._id })
      .select('sender text attachments createdAt deliveredAt')
      .populate('sender', 'name')
      .sort({ createdAt: 1 })
      .lean();
  }

  let pdf;
  try {
    pdf = await buildChatTranscriptPdf({ session, messages });
  } catch (error) {
    console.error('Admin chat transcript PDF generation failed', {
      sessionId: String(session._id),
      message: error?.message
    });
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Could not generate the chat transcript');
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${transcriptFilename(session)}"`);
  res.setHeader('Content-Length', pdf.length);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.end(pdf);
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
  const session = await Session.findByIdAndUpdate(
    req.params.id,
    {
      status: 'flagged',
      flagReason: req.body?.reason || '',
      flaggedAt: new Date(),
      flaggedBy: req.user?._id
    },
    { new: true }
  );
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  return sendResponse(res, { data: session });
});

export const adminRemoveFlagSession = catchAsync(async (req, res) => {
  const session = await Session.findByIdAndUpdate(
    req.params.id,
    {
      status: 'completed',
      flagReason: '',
      flaggedAt: null,
      flaggedBy: null
    },
    { new: true }
  );
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  return sendResponse(res, { message: 'Flag removed', data: session });
});

export const adminUpdateSessionNotes = catchAsync(async (req, res) => {
  const session = await Session.findByIdAndUpdate(
    req.params.id,
    { internalNotes: req.body?.internalNotes || '' },
    { new: true }
  );
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  return sendResponse(res, { message: 'Internal notes saved', data: session });
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
