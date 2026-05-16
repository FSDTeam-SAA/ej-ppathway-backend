import { Router } from 'express';
import { auth, requirePermission } from '../middlewares/auth.js';
import {
  submitContactMessage,
  adminListContactMessages,
  adminGetContactMessage,
  adminUpdateContactMessage,
  adminDeleteContactMessage,
  getContactMeta
} from '../controllers/contact.controller.js';

const router = Router();

// Public
router.get('/meta', getContactMeta);
router.post('/', submitContactMessage);

// Admin
router.get('/', auth('admin', 'sub_admin'), requirePermission('cms.manage'), adminListContactMessages);
router.get('/:id', auth('admin', 'sub_admin'), requirePermission('cms.manage'), adminGetContactMessage);
router.patch('/:id', auth('admin', 'sub_admin'), requirePermission('cms.manage'), adminUpdateContactMessage);
router.delete('/:id', auth('admin', 'sub_admin'), requirePermission('cms.manage'), adminDeleteContactMessage);

export default router;
