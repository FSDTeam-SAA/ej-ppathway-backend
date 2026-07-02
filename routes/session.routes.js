import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import {
  createBooking,
  advisorAvailability,
  myUserSessions,
  myAdvisorSessions,
  advisorBookingsCalendar,
  getSession,
  consentRecording,
  getLiveKitToken,
  advisorStartSession,
  endSession,
  sessionHeartbeat,
  extendSession,
  cancelSession,
  rescheduleSession,
  tipAdvisor,
  unlockSessionAsset,
  getOngoing,
  sessionSummary,
  saveSessionNote
} from '../controllers/session.controller.js';

const router = Router();

router.use(auth());

// Booking
router.post('/book', createBooking);
router.get('/advisors/:advisorId/availability', advisorAvailability);

// Listings
router.get('/mine/user', myUserSessions);
router.get('/mine/advisor', myAdvisorSessions);
router.get('/mine/calendar', advisorBookingsCalendar);
router.get('/ongoing', getOngoing);

// One session
router.get('/:id', getSession);
router.get('/:id/summary', sessionSummary);

// Lifecycle
router.post('/:id/consent', consentRecording);
router.post('/:id/livekit-token', getLiveKitToken);
router.post('/:id/advisor/start', advisorStartSession);
router.post('/:id/end', endSession);
router.post('/:id/heartbeat', sessionHeartbeat);
router.post('/:id/extend', extendSession);
router.post('/:id/cancel', cancelSession);
router.post('/:id/reschedule', rescheduleSession);
router.post('/:id/tip', tipAdvisor);
router.post('/:id/unlock', unlockSessionAsset);
router.post('/:id/notes', saveSessionNote);

export default router;
