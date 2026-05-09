import { Router } from 'express';
import {
  featured,
  topRated,
  searchAdvisors,
  getAdvisorDetails
} from '../controllers/publicAdvisor.controller.js';

const router = Router();

router.get('/featured', featured);
router.get('/top-rated', topRated);
router.get('/search', searchAdvisors);
router.get('/:advisorId', getAdvisorDetails);

export default router;
