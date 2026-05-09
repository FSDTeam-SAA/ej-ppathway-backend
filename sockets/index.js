import { Server as SocketIOServer } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt.js';
import User from '../models/user.model.js';
import Chat from '../models/chat.model.js';
import Message from '../models/message.model.js';

export const initSocket = (httpServer) => {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Auth token missing'));
      const decoded = verifyAccessToken(token);
      const user = await User.findById(decoded.sub).lean();
      if (!user) return next(new Error('User not found'));
      socket.user = user;
      next();
    } catch (e) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const uid = String(socket.user._id);
    socket.join(`user:${uid}`);

    socket.on('chat:join', ({ chatId }) => {
      if (chatId) socket.join(`chat:${chatId}`);
    });

    socket.on('chat:leave', ({ chatId }) => {
      if (chatId) socket.leave(`chat:${chatId}`);
    });

    socket.on('chat:typing', ({ chatId, typing }) => {
      socket.to(`chat:${chatId}`).emit('chat:typing', { userId: uid, typing });
    });

    socket.on('chat:send', async ({ chatId, text, attachments = [] }, ack) => {
      try {
        const chat = await Chat.findById(chatId);
        if (!chat) return ack?.({ ok: false, error: 'Chat not found' });
        const isP = chat.participants.some((p) => String(p) === uid);
        if (!isP && !['admin', 'sub_admin'].includes(socket.user.role)) {
          return ack?.({ ok: false, error: 'Forbidden' });
        }
        const msg = await Message.create({
          chat: chat._id,
          sender: socket.user._id,
          text: text || '',
          attachments
        });
        chat.lastMessage = text || (attachments.length ? '[attachment]' : '');
        chat.lastMessageAt = new Date();
        for (const p of chat.participants) {
          if (String(p) !== uid) {
            const cur = chat.unreadCounts.get(String(p)) || 0;
            chat.unreadCounts.set(String(p), cur + 1);
          }
        }
        await chat.save();
        io.to(`chat:${chat._id}`).emit('chat:new_message', { chatId: String(chat._id), message: msg });
        for (const p of chat.participants) {
          io.to(`user:${String(p)}`).emit('chat:updated', { chatId: String(chat._id), lastMessage: chat.lastMessage });
        }
        ack?.({ ok: true, message: msg });
      } catch (e) {
        ack?.({ ok: false, error: e.message });
      }
    });

    // Session presence
    socket.on('session:join', ({ sessionId }) => {
      if (sessionId) socket.join(`session:${sessionId}`);
    });
    socket.on('session:leave', ({ sessionId }) => {
      if (sessionId) socket.leave(`session:${sessionId}`);
    });
    socket.on('session:presence', ({ sessionId, state }) => {
      socket.to(`session:${sessionId}`).emit('session:presence', { userId: uid, state });
    });

    socket.on('disconnect', () => {
      // no-op
    });
  });

  return io;
};

export default initSocket;
