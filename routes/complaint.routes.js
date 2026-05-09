import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import { documentUpload } from '../middlewares/upload.js';
import {
  fileComplaint,
  fileSafetyReport,
  myComplaints
} from '../controllers/complaint.controller.js';

const router = Router();
router.use(auth());

router.post('/complain', documentUpload.array('documents', 5), fileComplaint);
router.post('/safety', documentUpload.array('documents', 5), fileSafetyReport);
router.get('/mine', myComplaints);

export default router;
