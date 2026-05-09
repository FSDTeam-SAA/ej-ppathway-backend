import { Router } from 'express';
import { auth, requirePermission } from '../middlewares/auth.js';
import { imageUpload } from '../middlewares/upload.js';
import {
  listBlogs,
  getBlog,
  createBlog,
  updateBlog,
  deleteBlog,
  listFaqs,
  adminListFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
  getPage,
  upsertPage
} from '../controllers/cms.controller.js';

const router = Router();

// Public reads
router.get('/blogs', listBlogs);
router.get('/blogs/:id', getBlog);
router.get('/faqs', listFaqs);
router.get('/pages/:slug', getPage);

// Admin writes
router.post(
  '/blogs',
  auth('admin', 'sub_admin'),
  requirePermission('cms.manage'),
  imageUpload.fields([
    { name: 'profile', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 }
  ]),
  createBlog
);
router.patch(
  '/blogs/:id',
  auth('admin', 'sub_admin'),
  requirePermission('cms.manage'),
  imageUpload.fields([
    { name: 'profile', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 }
  ]),
  updateBlog
);
router.delete('/blogs/:id', auth('admin', 'sub_admin'), requirePermission('cms.manage'), deleteBlog);

router.get('/admin/faqs', auth('admin', 'sub_admin'), requirePermission('faq.manage'), adminListFaqs);
router.post('/faqs', auth('admin', 'sub_admin'), requirePermission('faq.manage'), createFaq);
router.patch('/faqs/:id', auth('admin', 'sub_admin'), requirePermission('faq.manage'), updateFaq);
router.delete('/faqs/:id', auth('admin', 'sub_admin'), requirePermission('faq.manage'), deleteFaq);

router.put('/pages/:slug', auth('admin', 'sub_admin'), requirePermission('cms.manage'), upsertPage);

export default router;
