import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import { imageUpload, videoUpload } from '../middlewares/upload.js';
import {
  getMyApplication,
  updateMyApplication,
  uploadIntroVideo,
  getMyProfile,
  updateMyProfile,
  uploadProfilePhoto,
  setOnlineMode,
  getDashboard,
  getPerformance,
  getPromotionPlans,
  activatePromotion
} from '../controllers/advisor.controller.js';

const router = Router();

router.use(auth('advisor'));

// Application
router.get('/application', getMyApplication);
router.patch('/application', updateMyApplication);
router.post('/application/intro-video', videoUpload.single('video'), uploadIntroVideo);

// Profile management
router.get('/profile', getMyProfile);
router.patch('/profile', updateMyProfile);
router.post('/profile/photo', imageUpload.single('photo'), uploadProfilePhoto);
router.patch('/profile/online', setOnlineMode);

// Dashboard
router.get('/dashboard', getDashboard);
router.get('/performance', getPerformance);

// Promotions
router.get('/promotion-plans', getPromotionPlans);
router.post('/promotion/activate', activatePromotion);

export default router;
