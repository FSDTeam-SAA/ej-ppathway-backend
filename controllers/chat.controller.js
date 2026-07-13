import { StatusCodes } from 'http-status-codes';
import mongoose from 'mongoose';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import Chat from '../models/chat.model.js';
import Message from '../models/message.model.js';
import User from '../models/user.model.js';
import Session from '../models/session.model.js';
import { uploadBufferToCloudinary } from '../services/upload.service.js';
import { createNotification, broadcastSocket } from '../services/notification.service.js';
import { buildChatTranscriptPdf } from '../services/chatTranscriptPdf.service.js';

const MAX_TRANSCRIPT_MESSAGES = 10_000;
const PARTICIPANT_TRANSCRIPT_STATUSES = ['completed', 'flagged', 'disputed'];
const ADMIN_TRANSCRIPT_STATUSES = [
  ...PARTICIPANT_TRANSCRIPT_STATUSES,
  'cancelled',
  'expired',
  'no_show'
];

const canManageTranscript = (user) => {
  if (user.role === 'admin') return true;
  if (user.role !== 'sub_admin') return false;
  const permissions = user.permissions || [];
  return permissions.includes('*') || permissions.includes('recordings.transcripts');
};

const transcriptFilename = (session) => {
  const reference = String(session.sessionCode || session._id)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 80);
  return `session-chat-transcript-${reference || 'session'}.pdf`;
};

// ===== Get or create session chat =====
export const ensureSessionChat = catchAsync(async (req, res) => {
  const { sessionId } = req.params;
  const session = await Session.findById(sessionId);
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');

  const isUser = String(session.user) === String(req.user._id);
  const isAdvisor = String(session.advisor) === String(req.user._id);
  if (!isUser && !isAdvisor) throw new ApiError(StatusCodes.FORBIDDEN, 'Forbidden');

  let chat = await Chat.findOne({ kind: 'session', session: session._id });
  if (!chat) {
    chat = await Chat.create({
      kind: 'session',
      session: session._id,
      participants: [session.user, session.advisor]
    });
  }
  return sendResponse(res, { data: chat });
});

// ===== Admin support chat =====
export const ensureAdminChat = catchAsync(async (req, res) => {
  // Find first admin
  const admin = await User.findOne({ role: 'admin', status: 'active' });
  if (!admin) throw new ApiError(StatusCodes.NOT_FOUND, 'No admin available');

  let chat = await Chat.findOne({
    kind: 'admin',
    participants: { $all: [req.user._id, admin._id] }
  });
  if (!chat) {
    chat = await Chat.create({
      kind: 'admin',
      participants: [req.user._id, admin._id]
    });
    // Notify the admin inbox in realtime that a brand-new support chat exists.
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${String(admin._id)}`).emit('chat:updated', { chatId: String(chat._id), lastMessage: '' });
    }
  }
  return sendResponse(res, { data: chat });
});

// ===== Admin opens (or reuses) a support chat with a specific user =====
export const ensureAdminChatWith = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const target = await User.findById(userId).select('_id');
  if (!target) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');

  // Reuse the user's existing support thread if one exists (any admin participant),
  // otherwise open a fresh one between this admin and the target user.
  let chat = await Chat.findOne({ kind: 'admin', participants: target._id })
    .sort({ lastMessageAt: -1, updatedAt: -1 });
  if (!chat) {
    chat = await Chat.create({
      kind: 'admin',
      participants: [req.user._id, target._id]
    });
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${String(target._id)}`).emit('chat:updated', { chatId: String(chat._id), lastMessage: '' });
    }
  }
  return sendResponse(res, { data: chat });
});

export const myChats = catchAsync(async (req, res) => {
  const chats = await Chat.find({ participants: req.user._id })
    .populate('participants', 'name profilePhoto role')
    .sort({ lastMessageAt: -1, updatedAt: -1 }).lean();
  return sendResponse(res, { data: chats });
});

export const getChat = catchAsync(async (req, res) => {
  const chat = await Chat.findById(req.params.id).populate('participants', 'name profilePhoto role').lean();
  if (!chat) throw new ApiError(StatusCodes.NOT_FOUND, 'Chat not found');
  if (!chat.participants.some((p) => String(p._id) === String(req.user._id)) && req.user.role !== 'admin' && req.user.role !== 'sub_admin') {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Forbidden');
  }
  return sendResponse(res, { data: chat });
});

export const listMessages = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const chat = await Chat.findById(req.params.id);
  if (!chat) throw new ApiError(StatusCodes.NOT_FOUND, 'Chat not found');
  const isParticipant = chat.participants.some((p) => String(p) === String(req.user._id));
  const isAdmin = req.user.role === 'admin' || req.user.role === 'sub_admin';
  if (!isParticipant && !isAdmin) throw new ApiError(StatusCodes.FORBIDDEN, 'Forbidden');

  const total = await Message.countDocuments({ chat: chat._id });
  const items = await Message.find({ chat: chat._id })
    .sort({ createdAt: -1 }).skip(skip).limit(limit)
    .populate('sender', 'name profilePhoto role').lean();

  return sendResponse(res, { data: items.reverse(), meta: buildMeta({ page, limit, total }) });
});

// ===== Download a session chat as a PDF transcript =====
export const downloadChatTranscript = catchAsync(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid chat ID');
  }

  const chat = await Chat.findById(req.params.id);
  if (!chat) throw new ApiError(StatusCodes.NOT_FOUND, 'Chat not found');
  if (chat.kind !== 'session' || !chat.session) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Only session chats can be exported');
  }

  const session = await Session.findById(chat.session)
    .populate('user', 'name')
    .populate('advisor', 'name');
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');

  const userId = session.user?._id || session.user;
  const advisorId = session.advisor?._id || session.advisor;
  const isUser = String(userId) === String(req.user._id);
  const isAdvisor = String(advisorId) === String(req.user._id);
  const isAdmin = canManageTranscript(req.user);
  if (!isUser && !isAdvisor && !isAdmin) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'You cannot access this transcript');
  }
  if (isUser && !session.transcriptPriceUnlocked) {
    throw new ApiError(StatusCodes.PAYMENT_REQUIRED, 'Unlock this transcript before downloading it');
  }
  const readyStatuses = isAdmin
    ? ADMIN_TRANSCRIPT_STATUSES
    : PARTICIPANT_TRANSCRIPT_STATUSES;
  if (!readyStatuses.includes(session.status)) {
    throw new ApiError(StatusCodes.CONFLICT, 'The transcript is available after the session ends');
  }

  const total = await Message.countDocuments({ chat: chat._id });
  if (total > MAX_TRANSCRIPT_MESSAGES) {
    throw new ApiError(
      StatusCodes.REQUEST_TOO_LONG,
      `This transcript exceeds the ${MAX_TRANSCRIPT_MESSAGES}-message export limit`
    );
  }
  const messages = await Message.find({ chat: chat._id })
    .select('sender text attachments createdAt deliveredAt')
    .populate('sender', 'name')
    .sort({ createdAt: 1 })
    .lean();

  let pdf;
  try {
    pdf = await buildChatTranscriptPdf({ session, messages });
  } catch (error) {
    console.error('Chat transcript PDF generation failed', {
      chatId: String(chat._id),
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

export const sendMessage = catchAsync(async (req, res) => {
  const { text } = req.body;
  const chat = await Chat.findById(req.params.id);
  if (!chat) throw new ApiError(StatusCodes.NOT_FOUND, 'Chat not found');
  const isParticipant = chat.participants.some((p) => String(p) === String(req.user._id));
  const isAdmin = req.user.role === 'admin' || req.user.role === 'sub_admin';
  if (!isParticipant && !isAdmin) throw new ApiError(StatusCodes.FORBIDDEN, 'Forbidden');

  let attachments = [];
  if (req.files?.length) {
    for (const f of req.files) {
      const r = await uploadBufferToCloudinary(f.buffer, 'chat-attachments', 'auto');
      attachments.push(r.secure_url);
    }
  }

  if (!text && !attachments.length) throw new ApiError(StatusCodes.BAD_REQUEST, 'Message empty');

  const msg = await Message.create({
    chat: chat._id,
    sender: req.user._id,
    text: text || '',
    attachments
  });
  chat.lastMessage = text || (attachments.length ? '[attachment]' : '');
  chat.lastMessageAt = new Date();

  // bump unread for other participants
  for (const p of chat.participants) {
    if (String(p) !== String(req.user._id)) {
      const cur = chat.unreadCounts.get(String(p)) || 0;
      chat.unreadCounts.set(String(p), cur + 1);
    }
  }
  await chat.save();

  // emit via socket if available (set on app)
  const io = req.app.get('io');
  if (io) {
    io.to(`chat:${chat._id}`).emit('chat:new_message', { chatId: String(chat._id), message: msg });
    for (const p of chat.participants) {
      io.to(`user:${String(p)}`).emit('chat:updated', { chatId: String(chat._id), lastMessage: chat.lastMessage });
    }
  }

  // Support-chat notifications are symmetric: admin/sub-admin messages notify
  // advisors/users, and advisor/user messages notify the admin side.
  if (chat.kind === 'admin') {
    const recipients = chat.participants.filter((p) => String(p) !== String(req.user._id));
    for (const recipient of recipients) {
      const preview = (text || '').trim();
      const notif = await createNotification({
        recipient,
        type: 'new_message',
        title: `New support message from ${req.user.name || 'Support'}`,
        body: preview ? (preview.length > 140 ? `${preview.slice(0, 140)}…` : preview) : '[attachment]',
        data: { chatId: String(chat._id), messageId: String(msg._id), kind: 'support' }
      });
      if (io && notif) {
        broadcastSocket(io, recipient, 'notification:new', {
          _id: String(notif._id),
          type: 'new_message',
          title: notif.title,
          body: notif.body,
          data: notif.data,
          createdAt: notif.createdAt
        });
      }
    }
  }

  if (chat.kind === 'session') {
    const preview = (text || '').trim();
    const body = preview ? (preview.length > 140 ? `${preview.slice(0, 140)}…` : preview) : '[attachment]';
    const recipients = chat.participants.filter((p) => String(p) !== String(req.user._id));
    await Promise.all(recipients.map(async (recipient) => {
      const notif = await createNotification({
        recipient,
        type: 'new_message',
        title: `New message from ${req.user.name || 'a participant'}`,
        body,
        data: { chatId: String(chat._id), sessionId: chat.session ? String(chat.session) : undefined, messageId: String(msg._id), kind: 'session' }
      });
      if (io && notif) {
        const payload = {
          _id: String(notif._id),
          type: 'new_message',
          title: notif.title,
          body: notif.body,
          data: notif.data || {}
        };
        broadcastSocket(io, recipient, 'notification:new', payload);
        if (chat.session) {
          broadcastSocket(io, recipient, 'session:updated', {
            sessionId: String(chat.session),
            type: 'new_message'
          });
        }
      }
    }));
  }

  return sendResponse(res, { data: msg });
});

export const markChatRead = catchAsync(async (req, res) => {
  const chat = await Chat.findById(req.params.id);
  if (!chat) throw new ApiError(StatusCodes.NOT_FOUND, 'Chat not found');
  chat.unreadCounts.set(String(req.user._id), 0);
  await chat.save();
  await Message.updateMany(
    { chat: chat._id, readBy: { $ne: req.user._id } },
    { $addToSet: { readBy: req.user._id } }
  );
  return sendResponse(res, { message: 'Marked as read' });
});

// ===== Admin chat list =====
export const adminListChats = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { kind: 'admin' };
  const userFilter = {};
  if (['user', 'advisor'].includes(req.query.role)) {
    userFilter.role = req.query.role;
  }
  if (req.query.q) {
    userFilter.name = { $regex: req.query.q, $options: 'i' };
  }
  if (Object.keys(userFilter).length > 0) {
    const users = await User.find(userFilter).select('_id').lean();
    filter.participants = { $in: users.map((u) => u._id) };
  }
  const total = await Chat.countDocuments(filter);
  const items = await Chat.find(filter)
    .populate('participants', 'name profilePhoto role')
    .sort({ lastMessageAt: -1 }).skip(skip).limit(limit).lean();
  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

export const adminDeleteChat = catchAsync(async (req, res) => {
  const chat = await Chat.findOne({ _id: req.params.id, kind: 'admin' });
  if (!chat) throw new ApiError(StatusCodes.NOT_FOUND, 'Support chat not found');
  await Message.deleteMany({ chat: chat._id });
  await chat.deleteOne();
  return sendResponse(res, { message: 'Support chat deleted' });
});

export const adminBulkDeleteChats = catchAsync(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) throw new ApiError(StatusCodes.BAD_REQUEST, 'ids are required');
  const chats = await Chat.find({ _id: { $in: ids }, kind: 'admin' }).select('_id');
  const chatIds = chats.map((c) => c._id);
  await Message.deleteMany({ chat: { $in: chatIds } });
  await Chat.deleteMany({ _id: { $in: chatIds } });
  return sendResponse(res, { message: 'Support chats deleted', data: { deleted: chatIds.length } });
});
