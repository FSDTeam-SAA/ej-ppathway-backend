import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import { uploadBufferToCloudinary } from '../services/upload.service.js';
import User from '../models/user.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import AdvisorApplication from '../models/advisorApplication.model.js';
import Session from '../models/session.model.js';
import Review from '../models/review.model.js';
import Wallet from '../models/wallet.model.js';
import Transaction from '../models/transaction.model.js';
import { getPlatformSettings } from '../models/platformSetting.model.js';
import { computeTier } from '../services/tier.service.js';
import { getCountryCurrencyCode } from '../services/countryCurrency.service.js';
import { createNotification, broadcastSocket } from '../services/notification.service.js';
import { sendSessionAvailabilityChangedEmail } from '../services/email.service.js';

const ensureAdvisor = (user) => {
  if (user.role !== 'advisor') throw new ApiError(StatusCodes.FORBIDDEN, 'Advisors only');
};

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const RESCHEDULABLE_SESSION_STATUSES = ['pending', 'consent', 'waiting', 'scheduled'];

const normalizeWeeklySchedule = (weeklySchedule) => {
  if (!weeklySchedule || typeof weeklySchedule !== 'object') return weeklySchedule;
  const normalized = {};
  for (const day of DAY_KEYS) {
    const current = weeklySchedule[day] || {};
    const rawSlots = Array.isArray(current.slots) && current.slots.length
      ? current.slots
      : [{ from: current.from || '09:00', to: current.to || '18:00' }];
    const slots = rawSlots
      .map((slot) => ({
        from: String(slot?.from || '09:00').trim(),
        to: String(slot?.to || '18:00').trim()
      }))
      .filter((slot) => slot.from && slot.to);
    const first = slots[0] || { from: '09:00', to: '18:00' };
    normalized[day] = {
      enabled: current.enabled === true,
      from: first.from,
      to: first.to,
      slots: slots.length ? slots : [first]
    };
  }
  return normalized;
};

const normalizeDateAvailability = (dateAvailability) => {
  if (!dateAvailability || typeof dateAvailability !== 'object') return {};
  const entries = dateAvailability instanceof Map
    ? Array.from(dateAvailability.entries())
    : Object.entries(dateAvailability);
  const normalized = {};
  for (const [date, current] of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const rawSlots = Array.isArray(current?.slots) ? current.slots : [];
    const slots = rawSlots
      .map((slot) => ({
        from: String(slot?.from || '09:00').trim(),
        to: String(slot?.to || '18:00').trim()
      }))
      .filter((slot) => slot.from && slot.to);
    normalized[date] = {
      unavailable: current?.unavailable === true,
      slots: current?.unavailable === true ? [] : slots
    };
  }
  return normalized;
};

const stringifyComparable = (value) => JSON.stringify(value);

const toMinutes = (hhmm) => {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const [hour, minute] = hhmm.split(':').map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return hour * 60 + minute;
};

const scheduleSlots = (day) => {
  if (!day || day.enabled === false) return [];
  const rawSlots = Array.isArray(day.slots) && day.slots.length
    ? day.slots
    : [{ from: day.from, to: day.to }];
  return rawSlots
    .map((slot) => ({
      from: String(slot?.from || '').trim(),
      to: String(slot?.to || '').trim(),
      fromMinutes: toMinutes(slot?.from),
      toMinutes: toMinutes(slot?.to)
    }))
    .filter((slot) => slot.from && slot.to && slot.fromMinutes !== null && slot.toMinutes !== null);
};

const dateAvailabilityEntry = (dateAvailability, dateKey) => {
  if (!dateAvailability || !dateKey) return null;
  if (dateAvailability instanceof Map) return dateAvailability.get(dateKey) || null;
  return dateAvailability[dateKey] || null;
};

const dateOverrideActive = (entry) =>
  !!entry && (entry.unavailable === true || (Array.isArray(entry.slots) && entry.slots.length > 0));

const dateAvailabilitySlots = (day) => {
  if (!day || day.unavailable === true) return [];
  return (Array.isArray(day.slots) ? day.slots : [])
    .map((slot) => ({
      from: String(slot?.from || '').trim(),
      to: String(slot?.to || '').trim(),
      fromMinutes: toMinutes(slot?.from),
      toMinutes: toMinutes(slot?.to)
    }))
    .filter((slot) => slot.from && slot.to && slot.fromMinutes !== null && slot.toMinutes !== null);
};

const zonedParts = (date, timezone = 'UTC') => {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
  }
  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    weekday: (get('weekday') || '').toLowerCase(),
    hour: Number.parseInt(get('hour') || '0', 10),
    minute: Number.parseInt(get('minute') || '0', 10)
  };
};

const localDateKey = (parts) => `${parts.year}-${parts.month}-${parts.day}`;

const slotKey = (slot) => `${slot.from}-${slot.to}`;

const removedSlots = (beforeSlots, afterSlots) => {
  const after = new Set(afterSlots.map(slotKey));
  return beforeSlots.filter((slot) => !after.has(slotKey(slot)));
};

const dateWindowsForProfile = (profile, dateKey, weekday) => {
  const rule = dateAvailabilityEntry(profile?.dateAvailability, dateKey);
  if (dateOverrideActive(rule)) return rule.unavailable === true ? [] : dateAvailabilitySlots(rule);
  return scheduleSlots(profile?.weeklySchedule?.[weekday]);
};

const matchingAvailabilitySlot = (profile, date, timezone) => {
  const parts = zonedParts(date, timezone);
  const key = localDateKey(parts);
  const minuteOfDay = parts.hour * 60 + parts.minute;
  const windows = dateWindowsForProfile(profile, key, parts.weekday);
  return windows.find((slot) => {
    if (slot.toMinutes <= slot.fromMinutes) return minuteOfDay >= slot.fromMinutes || minuteOfDay < slot.toMinutes;
    return minuteOfDay >= slot.fromMinutes && minuteOfDay < slot.toMinutes;
  }) || null;
};

const sessionStillFitsAvailability = (profile, session, timezone) => {
  if (!session?.scheduledFor) return true;
  const start = new Date(session.scheduledFor);
  const duration = Math.max(1, Number(session.durationMinutes) || 15);
  const endProbe = new Date(start.getTime() + duration * 60 * 1000 - 60 * 1000);
  const startSlot = matchingAvailabilitySlot(profile, start, timezone);
  const endSlot = matchingAvailabilitySlot(profile, endProbe, timezone);
  return !!startSlot && !!endSlot && startSlot.from === endSlot.from && startSlot.to === endSlot.to;
};

const dateAvailabilityKeys = (value = {}) => {
  if (!value) return [];
  if (value instanceof Map) return Array.from(value.keys());
  return Object.keys(value);
};

const changedDateKeys = (before = {}, after = {}) => {
  const keys = new Set([...dateAvailabilityKeys(before), ...dateAvailabilityKeys(after)]);
  return [...keys].filter((key) =>
    stringifyComparable(dateAvailabilityEntry(before, key) || null) !==
    stringifyComparable(dateAvailabilityEntry(after, key) || null)
  );
};

const assertStartedAvailabilityNotRemoved = ({ existingProfile, nextProfile, timezone }) => {
  const now = new Date();
  const nowParts = zonedParts(now, timezone);
  const todayKey = localDateKey(nowParts);
  const nowMinutes = nowParts.hour * 60 + nowParts.minute;

  if (stringifyComparable(existingProfile?.weeklySchedule || {}) !== stringifyComparable(nextProfile?.weeklySchedule || {})) {
    const todayDay = nowParts.weekday;
    const before = scheduleSlots(existingProfile?.weeklySchedule?.[todayDay]);
    const after = scheduleSlots(nextProfile?.weeklySchedule?.[todayDay]);
    const removedStarted = removedSlots(before, after).find((slot) => slot.fromMinutes <= nowMinutes);
    if (removedStarted) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'This slot has already started and can no longer be changed.');
    }
  }

  for (const dateKey of changedDateKeys(existingProfile?.dateAvailability || {}, nextProfile?.dateAvailability || {})) {
    if (dateKey < todayKey) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Past availability can no longer be changed.');
    }
    const [year, month, day] = dateKey.split('-').map((part) => Number.parseInt(part, 10));
    const weekday = WEEKDAY_KEYS[new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()];
    const before = dateWindowsForProfile(existingProfile, dateKey, weekday);
    const after = dateWindowsForProfile(nextProfile, dateKey, weekday);
    const removed = removedSlots(before, after);
    if (dateKey === todayKey && removed.some((slot) => slot.fromMinutes <= nowMinutes)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'This slot has already started and can no longer be changed.');
    }
  }
};

const formatDateTime = (date, timezone = 'UTC') => {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
  } catch {
    return date.toISOString();
  }
};

const notifySessionsNeedingReschedule = async ({ req, advisor, nextProfile, timezone }) => {
  const sessions = await Session.find({
    advisor: advisor._id,
    status: { $in: RESCHEDULABLE_SESSION_STATUSES },
    scheduledFor: { $gte: new Date() },
    rescheduleReason: { $ne: 'advisor_changed_availability' }
  }).populate('user', 'name email notifPrefs');

  const affected = sessions.filter((session) => !sessionStillFitsAvailability(nextProfile, session, timezone));
  if (!affected.length) return 0;

  const io = req.app.get('io');
  const rescheduledAt = new Date();
  await Promise.all(affected.map(async (session) => {
    session.rescheduledFrom = session.rescheduledFrom || session.scheduledFor;
    session.rescheduleReason = 'advisor_changed_availability';
    session.rescheduledAt = rescheduledAt;
    await session.save();

    const notification = await createNotification({
      recipient: session.user?._id || session.user,
      type: 'session_rescheduled',
      title: 'Session needs a new time',
      body: `${advisor.name || 'Your advisor'} changed availability. Please choose a new time for your session.`,
      data: {
        sessionId: session._id,
        oldTime: session.scheduledFor,
        reason: 'advisor_changed_availability'
      }
    });
    if (notification) {
      const payload = {
        _id: String(notification._id),
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data || {}
      };
      broadcastSocket(io, session.user?._id || session.user, 'notification:new', payload);
      broadcastSocket(io, session.user?._id || session.user, 'session:rescheduled', {
        sessionId: String(session._id),
        type: notification.type
      });
    }

    if (session.user?.email && session.user?.notifPrefs?.email !== false) {
      await sendSessionAvailabilityChangedEmail(session.user.email, {
        name: session.user.name,
        advisorName: advisor.name,
        oldTime: formatDateTime(new Date(session.scheduledFor), timezone),
        rescheduleUrl: process.env.WEBSITE_URL ? `${process.env.WEBSITE_URL}/sessions/${session._id}` : ''
      }).catch((error) => console.error('availability change email error', error?.message));
    }
  }));
  return affected.length;
};

const normalizePricing = (pricing = {}) => ({
  chatPerMin: Number(pricing.chatPerMin || 0),
  callPerMin: Number(pricing.callPerMin || 0),
  videoPerMin: Number(pricing.videoPerMin || 0)
});

const pricingChanged = (existingProfile, profileUpdate) => {
  if (typeof profileUpdate.pricing === 'undefined') return false;
  if (!existingProfile) return true;

  const before = normalizePricing(existingProfile.pricing || {});
  const after = normalizePricing(profileUpdate.pricing || {});
  return stringifyComparable(before) !== stringifyComparable(after);
};

const markProfilePendingReview = async (userId) => {
  await Promise.all([
    AdvisorProfile.findOneAndUpdate(
      { user: userId },
      {
        $set: {
          profileReviewStatus: 'pending_review',
          profileSubmittedAt: new Date(),
          profileRejectionReason: ''
        },
        $setOnInsert: { user: userId }
      },
      { upsert: true }
    ),
    AdvisorApplication.findOneAndUpdate(
      { user: userId },
      {
        $set: {
          status: 'pending_review',
          stage: 'application'
        },
        $setOnInsert: { user: userId }
      },
      { upsert: true }
    )
  ]);
};

// ===== Application =====
export const getMyApplication = catchAsync(async (req, res) => {
  ensureAdvisor(req.user);
  const app = await AdvisorApplication.findOne({ user: req.user._id });
  return sendResponse(res, { data: app });
});

export const updateMyApplication = catchAsync(async (req, res) => {
  ensureAdvisor(req.user);
  const allowed = [
    'professionalTitle', 'bio', 'detailedDescription', 'yearsOfExperience',
    'expertise', 'styles', 'languages', 'preRecordedAnswers', 'pricing'
  ];
  const update = {};
  for (const k of allowed) if (typeof req.body[k] !== 'undefined') update[k] = req.body[k];

  const app = await AdvisorApplication.findOneAndUpdate(
    { user: req.user._id },
    { $set: update, $setOnInsert: { user: req.user._id } },
    { new: true, upsert: true }
  );
  return sendResponse(res, { data: app, message: 'Application updated' });
});

export const uploadIntroVideo = catchAsync(async (req, res) => {
  ensureAdvisor(req.user);
  if (!req.file) throw new ApiError(StatusCodes.BAD_REQUEST, 'audio or video file required');
  const isAudio = req.file.mimetype?.startsWith('audio/');
  const field = isAudio ? 'audioMessageUrl' : 'introVideoUrl';
  const folder = isAudio ? 'advisor-audio-messages' : 'advisor-intro-videos';
  const result = await uploadBufferToCloudinary(req.file.buffer, folder, 'video');
  await AdvisorApplication.findOneAndUpdate(
    { user: req.user._id },
    { [field]: result.secure_url },
    { upsert: true }
  );
  await AdvisorProfile.findOneAndUpdate(
    { user: req.user._id },
    { [field]: result.secure_url },
    { upsert: true }
  );
  return sendResponse(res, {
    data: {
      url: result.secure_url,
      mediaType: isAudio ? 'audio' : 'video',
      field
    }
  });
});

// ===== Profile =====
export const getMyProfile = catchAsync(async (req, res) => {
  ensureAdvisor(req.user);
  const profile = await AdvisorProfile.findOne({ user: req.user._id });
  const user = await User.findById(req.user._id);
  return sendResponse(res, { data: { user, profile } });
});

export const updateMyProfile = catchAsync(async (req, res) => {
  ensureAdvisor(req.user);
  const allowedProfile = [
    'professionalTitle', 'bio', 'detailedDescription', 'yearsOfExperience',
    'expertise', 'styles', 'languages', 'pricing', 'autoOnlineMode', 'weeklySchedule', 'dateAvailability', 'audioMessageUrl', 'introVideoUrl',
    'psychicExtension', 'tools', 'wordsOfWisdom', 'endorsements'
  ];
  const allowedUser = ['name', 'phone', 'country', 'city', 'profilePhoto', 'language', 'timezone'];
  const profileUpdate = {};
  const userUpdate = {};
  for (const k of allowedProfile) if (typeof req.body[k] !== 'undefined') profileUpdate[k] = req.body[k];
  for (const k of allowedUser) if (typeof req.body[k] !== 'undefined') userUpdate[k] = req.body[k];

  if (typeof profileUpdate.weeklySchedule !== 'undefined') {
    profileUpdate.weeklySchedule = normalizeWeeklySchedule(profileUpdate.weeklySchedule);
  }
  if (typeof profileUpdate.dateAvailability !== 'undefined') {
    profileUpdate.dateAvailability = normalizeDateAvailability(profileUpdate.dateAvailability);
  }

  // Keep the displayed currency in sync with the selected country (the country's
  // own default currency, so the right symbol shows everywhere).
  if (typeof userUpdate.country !== 'undefined') {
    userUpdate.country = (userUpdate.country || '').toString().trim().toUpperCase();
    userUpdate.currency = userUpdate.country
      ? getCountryCurrencyCode(userUpdate.country) || 'USD'
      : '';
  }

  const existingProfile = await AdvisorProfile.findOne({ user: req.user._id }).lean();
  const requiresAdminReview = pricingChanged(existingProfile, profileUpdate);
  const availabilityChanged =
    typeof profileUpdate.weeklySchedule !== 'undefined' ||
    typeof profileUpdate.dateAvailability !== 'undefined';

  const timezone = userUpdate.timezone || req.user.timezone || 'UTC';
  const nextProfileForAvailability = {
    ...(existingProfile || {}),
    ...profileUpdate,
    weeklySchedule: typeof profileUpdate.weeklySchedule !== 'undefined'
      ? profileUpdate.weeklySchedule
      : existingProfile?.weeklySchedule,
    dateAvailability: typeof profileUpdate.dateAvailability !== 'undefined'
      ? profileUpdate.dateAvailability
      : existingProfile?.dateAvailability
  };

  if (availabilityChanged && existingProfile) {
    assertStartedAvailabilityNotRemoved({
      existingProfile,
      nextProfile: nextProfileForAvailability,
      timezone
    });
  }

  const profile = await AdvisorProfile.findOneAndUpdate(
    { user: req.user._id },
    {
      $set: {
        ...profileUpdate,
        ...(requiresAdminReview
          ? {
              profileReviewStatus: 'pending_review',
              profileSubmittedAt: new Date(),
              profileRejectionReason: ''
            }
          : {})
      },
      $setOnInsert: { user: req.user._id }
    },
    { new: true, upsert: true }
  );
  const user = await User.findByIdAndUpdate(req.user._id, userUpdate, { new: true });

  if (requiresAdminReview) {
    await markProfilePendingReview(req.user._id);
  }

  const affectedSessions = availabilityChanged
    ? await notifySessionsNeedingReschedule({
        req,
        advisor: user || req.user,
        nextProfile: profile,
        timezone: user?.timezone || timezone
      })
    : 0;

  return sendResponse(res, {
    message: affectedSessions
      ? `Profile updated. ${affectedSessions} booked session${affectedSessions === 1 ? '' : 's'} need a new time, and clients were notified.`
      : requiresAdminReview
        ? 'Pricing changes submitted for admin review'
        : 'Profile updated',
    data: { user, profile, requiresAdminReview, affectedSessions }
  });
});

export const uploadProfilePhoto = catchAsync(async (req, res) => {
  if (!req.file) throw new ApiError(StatusCodes.BAD_REQUEST, 'image file required');
  const result = await uploadBufferToCloudinary(req.file.buffer, 'profile-photos', 'image');
  const user = await User.findByIdAndUpdate(req.user._id, { profilePhoto: result.secure_url }, { new: true });
  return sendResponse(res, { data: { user, url: result.secure_url } });
});

export const setOnlineMode = catchAsync(async (req, res) => {
  ensureAdvisor(req.user);
  const { isOnline } = req.body;
  const profile = await AdvisorProfile.findOneAndUpdate(
    { user: req.user._id },
    { isOnline: !!isOnline, lastSeenAt: new Date() },
    { new: true, upsert: true }
  );
  return sendResponse(res, { data: profile });
});

// ===== Dashboard =====
export const getDashboard = catchAsync(async (req, res) => {
  ensureAdvisor(req.user);
  const profile = await AdvisorProfile.findOne({ user: req.user._id }).lean();
  const wallet = await Wallet.findOne({ user: req.user._id }).lean();

  const range = ['week', 'month'].includes(req.query.range) ? req.query.range : 'today';
  const startOfRange = new Date();
  startOfRange.setHours(0, 0, 0, 0);
  if (range === 'week') {
    startOfRange.setDate(startOfRange.getDate() - 6);
  } else if (range === 'month') {
    startOfRange.setDate(1);
  }

  const rangeEarnings = await Transaction.aggregate([
    { $match: { advisor: req.user._id, type: 'advisor_earning', status: 'completed', createdAt: { $gte: startOfRange } } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  const activeSessions = await Session.countDocuments({ advisor: req.user._id, status: 'live' });
  const pendingRequests = await Session.countDocuments({ advisor: req.user._id, status: 'pending' });

  // ongoing session
  const ongoing = await Session.findOne({ advisor: req.user._id, status: 'live' })
    .populate('user', 'name profilePhoto').lean();

  // upcoming bookings
  const upcoming = await Session.find({
    advisor: req.user._id,
    status: 'pending',
    scheduledFor: { $gte: new Date() }
  })
    .populate('user', 'name profilePhoto')
    .sort({ scheduledFor: 1 })
    .limit(5).lean();

  // recent reviews
  const recentReviews = await Review.find({ advisor: req.user._id })
    .sort({ createdAt: -1 })
    .limit(2)
    .populate('user', 'name profilePhoto').lean();

  // weekly earnings curve
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const earningsCurve = await Transaction.aggregate([
    { $match: { advisor: req.user._id, type: 'advisor_earning', status: 'completed', createdAt: { $gte: weekAgo } } },
    { $group: { _id: { $dayOfWeek: '$createdAt' }, total: { $sum: '$amount' } } },
    { $sort: { _id: 1 } }
  ]);

  return sendResponse(res, {
    data: {
      earningsToday: rangeEarnings[0]?.total || 0,
      dashboardRange: range,
      activeSessions,
      pendingRequests,
      ratings: profile?.avgRating || 0,
      tier: profile?.tier === 'bronze' ? 'silver' : profile?.tier || 'silver',
      walletBalance: wallet?.earningsBalance || 0,
      ongoing,
      upcoming,
      recentReviews,
      earningsCurve,
      stats: {
        avgRating: profile?.avgRating || 0,
        repeatClientRate: profile?.repeatClientRate || 0,
        refundRate: profile?.refundRate || 0,
        sessionCompletion: (() => {
          const c = profile?.completedSessions || 0;
          const x = profile?.cancelledSessions || 0;
          const total = c + x;
          return total > 0 ? Math.round((c / total) * 100) : 0;
        })(),
        completedSessions: profile?.completedSessions || 0,
        cancelledSessions: profile?.cancelledSessions || 0
      }
    }
  });
});

// ===== Performance & Tier =====
export const getPerformance = catchAsync(async (req, res) => {
  ensureAdvisor(req.user);
  const profile = await AdvisorProfile.findOne({ user: req.user._id }).lean();
  const settings = await getPlatformSettings();

  // client retention buckets
  const sessions = await Session.aggregate([
    { $match: { advisor: req.user._id, status: 'completed' } },
    { $group: { _id: '$user', count: { $sum: 1 } } }
  ]);
  const retention = { '1-3': 0, '4-9': 0, '10+': 0 };
  for (const s of sessions) {
    if (s.count >= 10) retention['10+'] += 1;
    else if (s.count >= 4) retention['4-9'] += 1;
    else retention['1-3'] += 1;
  }

  await computeTier(req.user._id);
  const refreshed = await AdvisorProfile.findOne({ user: req.user._id }).lean();

  return sendResponse(res, {
    data: {
      avgRating: refreshed?.avgRating || 0,
      repeatRate: refreshed?.repeatClientRate || 0,
      avgResponseSec: refreshed?.avgResponseSec || 0,
      refundRate: refreshed?.refundRate || 0,
      ratingBreakdown: refreshed?.ratingBreakdown || {},
      retention,
      tier: refreshed?.tier === 'bronze' ? 'silver' : refreshed?.tier || 'silver',
      tierConfig: settings.tierThresholds
    }
  });
});

// ===== Promotions =====
export const getPromotionPlans = catchAsync(async (_req, res) => {
  const settings = await getPlatformSettings();
  const entries = settings.promotionPlans instanceof Map
    ? Array.from(settings.promotionPlans.entries())
    : Object.entries(settings.promotionPlans || {});
  const plans = Object.fromEntries(
    entries
      .filter(([, plan]) => plan?.isActive !== false)
      .sort(([, a], [, b]) => Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0))
      .map(([id, plan]) => [
        id,
        {
          label: plan.label || id,
          price: Number(plan.price || 0),
          days: Number(plan.days || 1),
          visibilityBoost: Number(plan.visibilityBoost || 1),
          impressionsPerDay: Number(plan.impressionsPerDay || 0),
          features: Array.isArray(plan.features) ? plan.features : [],
          tone: plan.tone || 'emerald',
          isPopular: plan.isPopular === true,
          sortOrder: Number(plan.sortOrder || 0)
        }
      ])
  );
  return sendResponse(res, { data: plans });
});

export const activatePromotion = catchAsync(async (req, res) => {
  ensureAdvisor(req.user);
  const { plan } = req.body;
  const settings = await getPlatformSettings();
  const planCfg = settings.promotionPlans instanceof Map
    ? settings.promotionPlans.get(plan)
    : settings.promotionPlans?.[plan];
  if (!planCfg || planCfg.isActive === false) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid plan');

  const wallet = await Wallet.findOne({ user: req.user._id });
  if (!wallet || wallet.earningsBalance < planCfg.price) {
    throw new ApiError(StatusCodes.PAYMENT_REQUIRED, 'Insufficient earnings balance');
  }
  wallet.earningsBalance -= planCfg.price;
  await wallet.save();

  await Transaction.create({
    type: 'promotion_purchase',
    status: 'completed',
    user: req.user._id,
    advisor: req.user._id,
    amount: planCfg.price,
    description: `Promotion plan ${plan} for ${planCfg.days} days`
  });

  const startsAt = new Date();
  const expiresAt = new Date(Date.now() + planCfg.days * 24 * 60 * 60 * 1000);

  const profile = await AdvisorProfile.findOneAndUpdate(
    { user: req.user._id },
    {
      activePromotion: { plan, startsAt, expiresAt, impressions: 0, profileViews: 0, clicks: 0, newClients: 0 }
    },
    { new: true, upsert: true }
  );
  return sendResponse(res, { message: 'Promotion activated', data: profile.activePromotion });
});
