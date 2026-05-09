import Notification from '../models/notification.model.js';

export const createNotification = async ({ recipient, type, title, body = '', data = {} }) => {
  if (!recipient) return null;
  try {
    return await Notification.create({ recipient, type, title, body, data });
  } catch (e) {
    console.error('createNotification error', e?.message);
    return null;
  }
};

export const broadcastSocket = (io, userId, event, payload) => {
  if (!io || !userId) return;
  io.to(`user:${String(userId)}`).emit(event, payload);
};

export default { createNotification, broadcastSocket };
