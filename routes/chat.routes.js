import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import { anyUpload } from '../middlewares/upload.js';
import {
  ensureSessionChat,
  ensureAdminChat,
  ensureAdminChatWith,
  myChats,
  getChat,
  listMessages,
  sendMessage,
  markChatRead,
  adminListChats
} from '../controllers/chat.controller.js';

const router = Router();
router.use(auth());

router.get('/mine', myChats);
router.get('/admin', auth('admin', 'sub_admin'), adminListChats);
router.post('/session/:sessionId', ensureSessionChat);
router.post('/admin', ensureAdminChat);
router.post('/admin/with/:userId', auth('admin', 'sub_admin'), ensureAdminChatWith);
router.get('/:id', getChat);
router.get('/:id/messages', listMessages);
router.post('/:id/messages', anyUpload.array('attachments', 5), sendMessage);
router.post('/:id/read', markChatRead);

export default router;
