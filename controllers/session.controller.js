import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { parsePagination, buildMeta } from '../utils/pagination.js';
import Session from '../models/session.model.js';
import User from '../models/user.model.js';
import Wallet from '../models/wallet.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import Transaction from '../models/transaction.model.js';
import Review from '../models/review.model.js';
import { generateLiveKitToken, createRoom, deleteRoom, startRoomRecording, stopEgress } from '../config/livekit.js';
import { settleSession, chargeUserWallet, refundToUserWallet } from '../services/session.service.js';
import { createNotification } from '../services/notification.service.js';

const round2 = (n) => Math.round(n * 100) / 100;

const sessionTypeRate = (profile, type) => {
  const p = profile?.pricing || {};
  if (type === 'chat') return p.chatPerMin || 1;
  if (type === 'call') return p.callPerMin || 1;
  if (type === 'video') return p.videoPerMin || 1;
  return 1;
};

// ============= Booking =============
export const createBooking = catchAsync(async (req, res) => {
  const { advisorId, type, scheduledFor, durationMinutes, instantStart } = req.body;

  if (!['chat', 'call', 'video'].includes(type)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid session type');
  }

  const advisor = await User.findOne({ _id: advisorId, role: 'advisor' });
  if (!advisor) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor not found');
  if (advisor.status !== 'active') throw new ApiError(StatusCodes.FORBIDDEN, 'Advisor not available');

  const profile = await AdvisorProfile.findOne({ user: advisorId });
  if (!profile) throw new ApiError(StatusCodes.NOT_FOUND, 'Advisor profile missing');

  const ratePerMin = sessionTypeRate(profile, type);
  const duration = Math.max(1, Number(durationMinutes) || 15);
  const estimatedCost = round2(ratePerMin * duration);

  // verify wallet has enough for estimated cost
  const wallet = await Wallet.findOne({ user: req.user._id });
  if (!wallet) throw new ApiError(StatusCodes.BAD_REQUEST, 'Wallet not found');
  if ((wallet.balance + wallet.freeCredits) < estimatedCost) {
    throw new ApiError(StatusCodes.PAYMENT_REQUIRED, 'Insufficient wallet balance to book');
  }

  const session = await Session.create({
    user: req.user._id,
    advisor: advisorId,
    type,
    status: 'pending',
    scheduledFor: instantStart ? new Date() : scheduledFor ? new Date(scheduledFor) : new Date(),
    durationMinutes: duration,
    instantStart: !!instantStart,
    ratePerMin,
    estimatedCost,
    holdAmount: estimatedCost
  });

  await createNotification({
    recipient: advisorId,
    type: 'session_request',
    title: 'New session request',
    body: `${req.user.name} requested a ${type} session`,
    data: { sessionId: session._id }
  });
  await createNotification({
    recipient: req.user._id,
    type: 'session_confirmed',
    title: 'Booking confirmed',
    body: `Your ${type} session is booked`,
    data: { sessionId: session._id }
  });

  return sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Session booked',
    data: session
  });
});

// ============= List sessions (user) =============
export const myUserSessions = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { user: req.user._id };

  const tab = req.query.tab; // all|today|upcoming|completed|canceled
  const now = new Date();
  if (tab === 'today') {
    const start = new Date(); start.setHours(0,0,0,0);
    const end = new Date(); end.setHours(23,59,59,999);
    filter.scheduledFor = { $gte: start, $lte: end };
  } else if (tab === 'upcoming') {
    filter.scheduledFor = { $gte: now };
    filter.status = 'pending';
  } else if (tab === 'completed') {
    filter.status = 'completed';
  } else if (tab === 'canceled') {
    filter.status = 'cancelled';
  }

  const total = await Session.countDocuments(filter);
  const items = await Session.find(filter)
    .populate('advisor', 'name profilePhoto')
    .sort({ scheduledFor: -1, createdAt: -1 })
    .skip(skip).limit(limit).lean();

  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

// ============= List sessions (advisor) =============
export const myAdvisorSessions = catchAsync(async (req, res) => {
  const { skip, limit, page } = parsePagination(req.query);
  const filter = { advisor: req.user._id };

  const tab = req.query.tab; // live|completed|cancelled|disputed|flagged
  if (tab === 'live') filter.status = 'live';
  else if (tab === 'completed') filter.status = 'completed';
  else if (tab === 'cancelled') filter.status = 'cancelled';
  else if (tab === 'disputed') filter.status = 'disputed';
  else if (tab === 'flagged') filter.status = 'flagged';

  const total = await Session.countDocuments(filter);
  const items = await Session.find(filter)
    .populate('user', 'name profilePhoto')
    .sort({ createdAt: -1 })
    .skip(skip).limit(limit).lean();

  return sendResponse(res, { data: items, meta: buildMeta({ page, limit, total }) });
});

// ============= Bookings (calendar) for advisor =============
export const advisorBookingsCalendar = catchAsync(async (req, res) => {
  const { from, to } = req.query;
  const filter = { advisor: req.user._id };
  if (from || to) filter.scheduledFor = {};
  if (from) filter.scheduledFor.$gte = new Date(from);
  if (to) filter.scheduledFor.$lte = new Date(to);

  const items = await Session.find(filter)
    .populate('user', 'name profilePhoto')
    .sort({ scheduledFor: 1 }).lean();

  return sendResponse(res, { data: items });
});

// ============= Session Details =============
export const getSession = catchAsync(async (req, res) => {
  const session = await Session.findById(req.params.id)
    .populate('user', 'name profilePhoto')
    .populate('advisor', 'name profilePhoto')
    .lean();
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  return sendResponse(res, { data: session });
});

// ============= Recording consent (user) =============
export const consentRecording = catchAsync(async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  if (String(session.user) !== String(req.user._id)) throw new ApiError(StatusCodes.FORBIDDEN, 'Forbidden');

  session.recordingConsented = true;
  if (session.status === 'pending') session.status = 'consent';
  await session.save();
  return sendResponse(res, { message: 'Consent recorded', data: session });
});

// ============= Get LiveKit token (user/advisor) =============
export const getLiveKitToken = catchAsync(async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');

  const isUser = String(session.user) === String(req.user._id);
  const isAdvisor = String(session.advisor) === String(req.user._id);
  if (!isUser && !isAdvisor) throw new ApiError(StatusCodes.FORBIDDEN, 'Not a participant');

  const roomName = session.livekitRoom || `session_${session._id}`;
  if (!session.livekitRoom) {
    session.livekitRoom = roomName;
    await createRoom(roomName, { maxParticipants: 2, metadata: { sessionId: String(session._id) } });
    await session.save();
  }

  // Mark waiting room joined for user
  if (isUser && !session.userJoinedAt) {
    session.userJoinedAt = new Date();
    if (session.status === 'consent' || session.status === 'pending') {
      session.status = 'waiting';
      session.waitingStartedAt = new Date();
    }
    await session.save();
  }
  if (isAdvisor && !session.advisorJoinedAt) {
    session.advisorJoinedAt = new Date();
    await session.save();
  }

  const { token, url } = await generateLiveKitToken({
    identity: String(req.user._id),
    name: req.user.name,
    roomName,
    metadata: { role: isAdvisor ? 'advisor' : 'user', sessionId: String(session._id) }
  });

  return sendResponse(res, { data: { token, url, roomName } });
});

// ============= Advisor starts session =============
export const advisorStartSession = catchAsync(async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  if (String(session.advisor) !== String(req.user._id)) throw new ApiError(StatusCodes.FORBIDDEN, 'Forbidden');

  if (session.status === 'live') return sendResponse(res, { data: session });
  if (!['waiting', 'consent', 'pending'].includes(session.status))
    throw new ApiError(StatusCodes.BAD_REQUEST, `Cannot start session in status ${session.status}`);

  // pre-charge a small hold for first minute (cap at remaining wallet)
  const holdAmount = Math.min(session.holdAmount || session.estimatedCost || 0, session.ratePerMin * 1);
  if (holdAmount > 0) {
    try {
      const { creditsUsed, balanceUsed } = await chargeUserWallet({ userId: session.user, amount: holdAmount });
      session.creditsUsed = round2((session.creditsUsed || 0) + creditsUsed);
      session.chargedAmount = round2((session.chargedAmount || 0) + creditsUsed + balanceUsed);
      await Transaction.create({
        type: 'session_charge',
        status: 'completed',
        user: session.user,
        advisor: session.advisor,
        session: session._id,
        amount: round2(creditsUsed + balanceUsed),
        description: `Initial hold for session ${session.sessionCode}`
      });
    } catch (e) {
      throw new ApiError(StatusCodes.PAYMENT_REQUIRED, 'User has insufficient funds');
    }
  }

  session.status = 'live';
  session.startedAt = new Date();

  // Optionally start recording if consented + video/call
  if (session.recordingConsented && (session.type === 'call' || session.type === 'video')) {
    const filename = `recordings/${session._id}-${Date.now()}.mp4`;
    const egress = await startRoomRecording(session.livekitRoom || `session_${session._id}`, filename);
    if (egress?.egressId) session.egressId = egress.egressId;
  }

  await session.save();

  await createNotification({
    recipient: session.user,
    type: 'session_started',
    title: 'Session started',
    body: 'Your advisor has started the session',
    data: { sessionId: session._id }
  });

  return sendResponse(res, { message: 'Session live', data: session });
});

// ============= End session =============
export const endSession = catchAsync(async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  if (
    String(session.user) !== String(req.user._id) &&
    String(session.advisor) !== String(req.user._id)
  ) throw new ApiError(StatusCodes.FORBIDDEN, 'Forbidden');

  if (session.status !== 'live') throw new ApiError(StatusCodes.BAD_REQUEST, 'Session is not live');

  session.endedAt = new Date();
  if (session.egressId) await stopEgress(session.egressId);

  await settleSession(session);
  await session.save();

  // tear down room
  if (session.livekitRoom) await deleteRoom(session.livekitRoom);

  await createNotification({
    recipient: session.user,
    type: 'session_completed',
    title: 'Session completed',
    body: 'Your session has ended. Leave a review?',
    data: { sessionId: session._id }
  });
  await createNotification({
    recipient: session.advisor,
    type: 'session_completed',
    title: 'Session completed',
    body: 'Session ended successfully',
    data: { sessionId: session._id }
  });

  return sendResponse(res, { message: 'Session ended', data: session });
});

// ============= Heartbeat / per-minute charge =============
export const sessionHeartbeat = catchAsync(async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  if (
    String(session.user) !== String(req.user._id) &&
    String(session.advisor) !== String(req.user._id)
  ) throw new ApiError(StatusCodes.FORBIDDEN, 'Forbidden');
  if (session.status !== 'live') return sendResponse(res, { data: { ended: true, session } });

  const elapsedSec = Math.max(0, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000));
  const elapsedMin = elapsedSec / 60;
  const targetCharge = round2(elapsedMin * session.ratePerMin);
  const diff = round2(targetCharge - (session.chargedAmount || 0));

  let lowBalanceWarning = false;
  let autoEnded = false;

  if (diff > 0) {
    try {
      const { creditsUsed, balanceUsed } = await chargeUserWallet({ userId: session.user, amount: diff });
      session.creditsUsed = round2((session.creditsUsed || 0) + creditsUsed);
      session.chargedAmount = round2((session.chargedAmount || 0) + creditsUsed + balanceUsed);
      await Transaction.create({
        type: 'session_charge',
        status: 'completed',
        user: session.user,
        advisor: session.advisor,
        session: session._id,
        amount: round2(creditsUsed + balanceUsed),
        description: `Per-minute charge for ${session.sessionCode}`
      });
    } catch (e) {
      // insufficient balance: end session
      session.endedAt = new Date();
      if (session.egressId) await stopEgress(session.egressId);
      await settleSession(session);
      autoEnded = true;
      await createNotification({
        recipient: session.user,
        type: 'low_balance',
        title: 'Session ended — low balance',
        body: 'Your wallet ran out of funds. Add funds to continue next time.',
        data: { sessionId: session._id }
      });
    }
  }

  // Low balance warning if remaining < threshold
  const wallet = await Wallet.findOne({ user: session.user }).lean();
  const remainingMins = ((wallet?.balance || 0) + (wallet?.freeCredits || 0)) / session.ratePerMin;
  if (!autoEnded && remainingMins < (Number(process.env.SESSION_LOW_BALANCE_THRESHOLD_MIN) || 2)) {
    lowBalanceWarning = true;
  }

  await session.save();

  return sendResponse(res, {
    data: {
      session,
      elapsedSec,
      remainingMins: Math.max(0, remainingMins),
      lowBalanceWarning,
      autoEnded
    }
  });
});

// ============= Extend session =============
export const extendSession = catchAsync(async (req, res) => {
  const { minutes } = req.body; // 5|10|15
  const session = await Session.findById(req.params.id);
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  if (String(session.user) !== String(req.user._id)) throw new ApiError(StatusCodes.FORBIDDEN, 'Only the user can extend');
  if (session.status !== 'live') throw new ApiError(StatusCodes.BAD_REQUEST, 'Session is not live');

  const cost = round2((minutes || 0) * session.ratePerMin);
  if (cost <= 0) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid minutes');

  // verify availability of funds
  const wallet = await Wallet.findOne({ user: session.user });
  if ((wallet?.balance || 0) + (wallet?.freeCredits || 0) < cost) {
    throw new ApiError(StatusCodes.PAYMENT_REQUIRED, 'Insufficient balance to extend');
  }

  session.durationMinutes = (session.durationMinutes || 0) + Number(minutes);
  session.extensions.push({ minutes: Number(minutes), cost });
  await session.save();

  return sendResponse(res, { message: 'Session extended', data: session });
});

// ============= Cancel session (user or advisor) =============
export const cancelSession = catchAsync(async (req, res) => {
  const { reason } = req.body;
  const session = await Session.findById(req.params.id);
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');

  const isUser = String(session.user) === String(req.user._id);
  const isAdvisor = String(session.advisor) === String(req.user._id);
  if (!isUser && !isAdvisor) throw new ApiError(StatusCodes.FORBIDDEN, 'Forbidden');
  if (!['pending', 'consent', 'waiting'].includes(session.status)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Cannot cancel session in status ${session.status}`);
  }

  // refund any held charge
  if ((session.chargedAmount || 0) > 0) {
    await refundToUserWallet({ userId: session.user, amount: session.chargedAmount });
    await Transaction.create({
      type: 'session_refund',
      status: 'completed',
      user: session.user,
      session: session._id,
      amount: session.chargedAmount,
      description: `Refund for cancelled session ${session.sessionCode}`
    });
    session.refundIssued = round2((session.refundIssued || 0) + session.chargedAmount);
    session.chargedAmount = 0;
  }

  session.status = 'cancelled';
  session.cancelledBy = req.user._id;
  session.cancelReason = reason || '';
  session.cancelledAt = new Date();
  await session.save();

  if (session.livekitRoom) await deleteRoom(session.livekitRoom);

  // Update advisor stats (cancelled count)
  if (isAdvisor) {
    await AdvisorProfile.findOneAndUpdate({ user: session.advisor }, { $inc: { cancelledSessions: 1 } });
  }

  await createNotification({
    recipient: isUser ? session.advisor : session.user,
    type: 'session_cancelled',
    title: 'Session cancelled',
    body: `Session was cancelled${reason ? ': ' + reason : ''}`,
    data: { sessionId: session._id }
  });

  return sendResponse(res, { message: 'Session cancelled and any holds refunded', data: session });
});

// ============= Reschedule session =============
export const rescheduleSession = catchAsync(async (req, res) => {
  const { newScheduledFor, reason } = req.body;
  const session = await Session.findById(req.params.id);
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  if (
    String(session.user) !== String(req.user._id) &&
    String(session.advisor) !== String(req.user._id)
  ) throw new ApiError(StatusCodes.FORBIDDEN, 'Forbidden');

  if (!['pending', 'consent', 'waiting'].includes(session.status)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Cannot reschedule session in status ${session.status}`);
  }

  session.rescheduledFrom = session.scheduledFor;
  session.scheduledFor = new Date(newScheduledFor);
  session.rescheduleReason = reason || '';
  session.rescheduledAt = new Date();
  await session.save();

  await createNotification({
    recipient: String(req.user._id) === String(session.user) ? session.advisor : session.user,
    type: 'session_rescheduled',
    title: 'Session rescheduled',
    body: `Session moved to ${session.scheduledFor.toISOString()}`,
    data: { sessionId: session._id }
  });

  return sendResponse(res, { message: 'Session rescheduled', data: session });
});

// ============= Tip advisor =============
export const tipAdvisor = catchAsync(async (req, res) => {
  const { amount } = req.body;
  const session = await Session.findById(req.params.id);
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  if (String(session.user) !== String(req.user._id)) throw new ApiError(StatusCodes.FORBIDDEN, 'Only the user can tip');
  if (!amount || Number(amount) <= 0) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid amount');

  const amt = round2(Number(amount));
  await chargeUserWallet({ userId: session.user, amount: amt });
  await Wallet.findOneAndUpdate({ user: session.advisor }, { $inc: { earningsBalance: amt, totalEarned: amt } }, { upsert: true });

  await Transaction.create({
    type: 'tip',
    status: 'completed',
    user: session.user,
    advisor: session.advisor,
    session: session._id,
    amount: amt,
    description: `Tip for session ${session.sessionCode}`
  });
  await Transaction.create({
    type: 'advisor_tip',
    status: 'completed',
    user: session.user,
    advisor: session.advisor,
    session: session._id,
    amount: amt,
    description: `Tip received from session ${session.sessionCode}`
  });

  session.tipAmount = round2((session.tipAmount || 0) + amt);
  await session.save();

  await createNotification({
    recipient: session.advisor,
    type: 'tip_received',
    title: 'You received a tip',
    body: `$${amt} tip from your client`,
    data: { sessionId: session._id, amount: amt }
  });

  return sendResponse(res, { message: 'Tip sent', data: session });
});

// ============= Unlock recording / transcript =============
export const unlockSessionAsset = catchAsync(async (req, res) => {
  const { asset } = req.body; // 'recording' | 'transcript'
  const session = await Session.findById(req.params.id);
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  if (String(session.user) !== String(req.user._id)) throw new ApiError(StatusCodes.FORBIDDEN, 'Forbidden');

  let amount = 0;
  if (asset === 'recording') amount = session.unlockChargeRecording;
  else if (asset === 'transcript') amount = session.unlockChargeTranscript;
  else throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid asset');

  await chargeUserWallet({ userId: session.user, amount });
  await Transaction.create({
    type: asset === 'recording' ? 'unlock_recording' : 'unlock_transcript',
    status: 'completed',
    user: session.user,
    session: session._id,
    amount,
    description: `Unlock ${asset} for session ${session.sessionCode}`
  });

  if (asset === 'recording') session.recordingPriceUnlocked = true;
  else session.transcriptPriceUnlocked = true;

  await session.save();
  return sendResponse(res, { message: `${asset} unlocked`, data: session });
});

// ============= Ongoing session for user =============
export const getOngoing = catchAsync(async (req, res) => {
  const isAdvisor = req.user.role === 'advisor';
  const filter = isAdvisor ? { advisor: req.user._id, status: 'live' } : { user: req.user._id, status: 'live' };
  const session = await Session.findOne(filter)
    .populate('user', 'name profilePhoto')
    .populate('advisor', 'name profilePhoto')
    .lean();
  return sendResponse(res, { data: session });
});

// ============= Session complete summary (for "Session Completed" modal) =============
export const sessionSummary = catchAsync(async (req, res) => {
  const session = await Session.findById(req.params.id)
    .populate('user', 'name profilePhoto')
    .populate('advisor', 'name profilePhoto')
    .lean();
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');

  const review = await Review.findOne({ session: session._id }).lean();
  return sendResponse(res, { data: { session, review } });
});

// ============= Save advisor session note =============
export const saveSessionNote = catchAsync(async (req, res) => {
  // Notes are stored as a quick metadata field (no separate model needed)
  const { notes } = req.body;
  const session = await Session.findById(req.params.id);
  if (!session) throw new ApiError(StatusCodes.NOT_FOUND, 'Session not found');
  if (String(session.advisor) !== String(req.user._id)) throw new ApiError(StatusCodes.FORBIDDEN, 'Forbidden');
  session.set('advisorNotes', notes || '');
  await session.save();
  return sendResponse(res, { data: session });
});
