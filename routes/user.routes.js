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
  listFavorites
} from '../controllers/user.controller.js';

const router = Router();

router.use(auth());

router.get('/profile', getProfile);
router.patch('/profile', imageUpload.single('profilePhoto'), updateProfile);
router.patch('/notification-prefs', updateNotificationPrefs);
router.post('/fcm-tokens', registerFcmToken);
router.delete('/fcm-tokens', removeFcmToken);
router.post('/deactivate', deactivateAccount);

router.post('/favorites/:advisorId', addFavorite);
router.delete('/favorites/:advisorId', removeFavorite);
router.get('/favorites', listFavorites);

export default router;
