import { Router } from 'express';
import {
  signupUser,
  signupAdvisor,
  advisorApply,
  verifyOtp,
  resendOtp,
  login,
  forgotPasswordSendOtp,
  resetPassword,
  changePassword,
  refreshToken,
  me
} from '../controllers/auth.controller.js';
import { auth } from '../middlewares/auth.js';
import { anyUpload } from '../middlewares/upload.js';

const router = Router();

router.post('/signup', signupUser);
router.post('/advisor/signup', signupAdvisor);
router.post(
  '/advisor-apply',
  anyUpload.fields([
    { name: 'introVideo', maxCount: 1 },
    { name: 'profilePhoto', maxCount: 1 }
  ]),
  advisorApply
);
router.post('/verify-otp', verifyOtp);
router.post('/resend-otp', resendOtp);
router.post('/login', login);
router.post('/forgot-password', forgotPasswordSendOtp);
router.post('/reset-password', resetPassword);
router.post('/refresh', refreshToken);
router.post('/change-password', auth(), changePassword);
router.get('/me', auth(), me);

export default router;
