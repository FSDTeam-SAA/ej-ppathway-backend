import { StatusCodes } from 'http-status-codes';
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

  // When a customer writes into a support chat, raise a bell notification for the admin.
  if (chat.kind === 'admin' && !isAdmin) {
    const adminId = chat.participants.find((p) => String(p) !== String(req.user._id));
    if (adminId) {
      const preview = (text || '').trim();
      const notif = await createNotification({
        recipient: adminId,
        type: 'new_message',
        title: `New support message from ${req.user.name || 'a customer'}`,
        body: preview ? (preview.length > 140 ? `${preview.slice(0, 140)}…` : preview) : '[attachment]',
        data: { chatId: String(chat._id), messageId: String(msg._id), kind: 'support' }
      });
      if (io && notif) {
        broadcastSocket(io, adminId, 'notification:new', {
          _id: String(notif._id),
          type: 'new_message',
          title: notif.title,
          body: notif.body
        });
      }
    }
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
  if (req.query.q) {
    // search by participant name
    const term = req.query.q;
    const users = await User.find({ name: { $regex: term, $options: 'i' } }).select('_id').lean();
    filter.participants = { $in: users.map((u) => u._id) };
  }
  const total = await Chat.countDocuments(filter);
  const items = await Chat.find(filter)
    .populate('participants', 'name profilePhoto role')
    .sort({ lastMessageAt: -1 }).skip(skip).limit(limit).lean();
  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});
