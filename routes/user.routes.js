import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import { imageUpload } from '../middlewares/upload.js';
import {
  getProfile,
  updateProfile,
  updateNotificationPrefs,
  registerFcmToken,
  removeFcmToken,
  deactivateAccount,
  addFavorite,
  removeFavorite,
  listFavorites,
  getOnboardingQuestions,
  getPreferences,
  submitPreferences
} from '../controllers/user.controller.js';

const router = Router();

// Public: lets the frontend render the questionnaire without an account yet.
router.get('/onboarding/questions', getOnboardingQuestions);

router.use(auth());

router.get('/profile', getProfile);
router.patch('/profile', imageUpload.single('profilePhoto'), updateProfile);
router.patch('/notification-prefs', updateNotificationPrefs);
router.post('/fcm-tokens', registerFcmToken);
router.delete('/fcm-tokens', removeFcmToken);
router.post('/deactivate', deactivateAccount);

// Onboarding preferences (8-step questionnaire after OTP verify, before plan pick)
router.get('/preferences', getPreferences);
router.put('/preferences', submitPreferences);

router.post('/favorites/:advisorId', addFavorite);
router.delete('/favorites/:advisorId', removeFavorite);
router.get('/favorites', listFavorites);

export default router;
