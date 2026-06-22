import Notification from '../models/notification.model.js';
import { registerJobHandler } from './jobQueue.service.js';
import { broadcastSocket } from './notification.service.js';

export const NOTIFICATION_BROADCAST_JOB = 'notification.broadcast.batch';

export const registerNotificationJobHandlers = ({ io } = {}) => {
  registerJobHandler(NOTIFICATION_BROADCAST_JOB, async (payload) => {
    const {
      recipientIds = [],
      title,
      body = '',
      data = {},
      type = 'admin_announcement'
    } = payload || {};

    const docs = recipientIds
      .filter(Boolean)
      .map((recipient) => ({ recipient, type, title, body, data }));

    if (!docs.length) return { inserted: 0 };

    const inserted = await Notification.insertMany(docs, { ordered: false });

    for (const n of inserted) {
      broadcastSocket(io, n.recipient, 'notification:new', {
        _id: String(n._id),
        type: n.type,
        title: n.title,
        body: n.body
      });
    }

    return { inserted: inserted.length };
  });
};

export default { registerNotificationJobHandlers, NOTIFICATION_BROADCAST_JOB };
