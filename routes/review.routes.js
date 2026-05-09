import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import {
  submitReview,
  listAdvisorReviews,
  listShowcaseReviews
} from '../controllers/review.controller.js';

const router = Router();

router.get('/showcase', listShowcaseReviews);
router.get('/advisor/:advisorId', listAdvisorReviews);
router.post('/', auth(), submitReview);

export default router;
