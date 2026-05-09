import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import { documentUpload } from '../middlewares/upload.js';
import {
  openDispute,
  cancelDispute,
  listMyDisputes,
  getDispute
} from '../controllers/dispute.controller.js';

const router = Router();
router.use(auth());

router.post('/', documentUpload.array('documents', 5), openDispute);
router.get('/', listMyDisputes);
router.get('/:id', getDispute);
router.post('/:id/cancel', cancelDispute);

export default router;
