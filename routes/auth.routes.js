import { Router } from 'express';
import {
  signupUser,
  signupAdvisor,
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

const router = Router();

router.post('/signup', signupUser);
router.post('/advisor/signup', signupAdvisor);
router.post('/verify-otp', verifyOtp);
router.post('/resend-otp', resendOtp);
router.post('/login', login);
router.post('/forgot-password', forgotPasswordSendOtp);
router.post('/reset-password', resetPassword);
router.post('/refresh', refreshToken);
router.post('/change-password', auth(), changePassword);
router.get('/me', auth(), me);

export default router;
