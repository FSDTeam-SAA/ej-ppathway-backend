import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import {
  listMyNotifications,
  myNotificationSummary,
  markAsRead,
  markAllRead,
  deleteNotification,
  bulkDeleteNotifications,
  adminBroadcast
} from '../controllers/notification.controller.js';

const router = Router();

router.use(auth());

router.get('/me', myNotificationSummary);
router.get('/', listMyNotifications);
router.patch('/:id/read', markAsRead);
router.post('/read-all', markAllRead);
router.post('/bulk-delete', bulkDeleteNotifications);
router.delete('/:id', deleteNotification);

router.post('/admin/broadcast', auth('admin', 'sub_admin'), adminBroadcast);

export default router;
