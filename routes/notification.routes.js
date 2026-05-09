import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import {
  listMyNotifications,
  markAsRead,
  markAllRead,
  deleteNotification,
  adminBroadcast
} from '../controllers/notification.controller.js';

const router = Router();

router.use(auth());

router.get('/', listMyNotifications);
router.patch('/:id/read', markAsRead);
router.post('/read-all', markAllRead);
router.delete('/:id', deleteNotification);

router.post('/admin/broadcast', auth('admin', 'sub_admin'), adminBroadcast);

export default router;
