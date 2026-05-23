import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import sendResponse from '../utils/sendResponse.js';
import User from '../models/user.model.js';

// ---------- Range helpers ----------

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const startOfWeek = (d) => {
  // Week starts on Monday — Sunday is the last data point in the chart.
  const x = startOfDay(d);
  const day = x.getDay();              // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day);
  x.setDate(x.getDate() + diff);
  return x;
};

const endOfWeek = (d) => {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return endOfDay(e);
};

const startOfMonth = (d) => {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
};

const endOfMonth = (d) => {
  const x = startOfMonth(d);
  x.setMonth(x.getMonth() + 1);
  x.setMilliseconds(-1);
  return x;
};

const parseRange = (query) => {
  const now = new Date();
  const range = (query.range || 'this-week').toString();

  if (query.start && query.end) {
    const start = new Date(query.start);
    const end = new Date(query.end);
    if (isNaN(start) || isNaN(end) || start > end) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid start/end dates');
    }
    return { start: startOfDay(start), end: endOfDay(end), key: 'custom' };
  }

  switch (range) {
    case 'today':
      return { start: startOfDay(now), end: endOfDay(now), key: 'today' };
    case 'this-month':
      return { start: startOfMonth(now), end: endOfMonth(now), key: 'this-month' };
    case 'custom':
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Custom range requires start and end query params');
    case 'this-week':
    default:
      return { start: startOfWeek(now), end: endOfWeek(now), key: 'this-week' };
  }
};

const formatLabel = (d) => {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`;
};

// ---------- Aggregation ----------

const STEP_LABELS = [
  'Step 1 : User Intent',
  'Step 2 : Guidance Style',
  'Step 3 : Communication Method',
  'Step 4 : Comfort & Personality',
  'Step 5 : Usage Frequency',
  'Step 6 : Focus Area',
  'Step 7 : Trust Priorities',
  'Step 8 : Review & complete'
];

const PAYWALL_LABELS = {
  wallet_selected: 'Wallet Selected',
  subscription_selected: 'Subscription Selected',
  payment_completed: 'Payment Completed',
  abandoned: 'Abandoned'
};

const PAYWALL_COLORS = {
  wallet_selected: '#10b981',
  subscription_selected: '#fbbf24',
  payment_completed: '#bae6fd',
  abandoned: '#0a7a90'
};

const DEVICE_LABELS = {
  mobile_app: 'Mobile app',
  mobile_web: 'Mobile Web',
  desktop: 'Desktop'
};

const DEVICE_COLORS = {
  mobile_app: '#10b981',
  mobile_web: '#fbbf24',
  desktop: '#0a7a90'
};

const round1 = (n) => Math.round(n * 10) / 10;

const pct = (n, total) => (total > 0 ? round1((n / total) * 100) : 0);

const formatDuration = (ms) => {
  if (!ms || ms < 0) return '0s';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
};

export const onboardingAnalytics = catchAsync(async (req, res) => {
  const { start, end, key } = parseRange(req.query);
  const prevSpan = end.getTime() - start.getTime();
  const prevStart = new Date(start.getTime() - prevSpan - 1);
  const prevEnd = new Date(start.getTime() - 1);

  const baseMatch = { role: 'user' };

  // Anyone who *started* onboarding in the window. Fall back to signups in the
  // window so the page still works for legacy users created before tracking
  // was added (their startedAt may be null).
  const startedMatch = {
    ...baseMatch,
    $or: [
      { 'onboarding.startedAt': { $gte: start, $lte: end } },
      { 'onboarding.startedAt': { $exists: false }, createdAt: { $gte: start, $lte: end } },
      { 'onboarding.startedAt': null, createdAt: { $gte: start, $lte: end } }
    ]
  };

  const completedMatch = {
    ...baseMatch,
    onboardingCompleted: true,
    $or: [
      { 'onboarding.completedAt': { $gte: start, $lte: end } },
      { 'onboarding.completedAt': { $exists: false }, 'preferences.completedAt': { $gte: start, $lte: end } }
    ]
  };

  const [
    started,
    completed,
    prevStarted,
    prevCompleted,
    stepCounts,
    durationsAgg,
    deviceAgg,
    paywallReached,
    paywallActionAgg,
    completionByDay,
    mobileCompleted,
    mobileStarted,
    prevMobileCompleted,
    prevMobileStarted
  ] = await Promise.all([
    User.countDocuments(startedMatch),
    User.countDocuments(completedMatch),
    User.countDocuments({
      ...baseMatch,
      $or: [
        { 'onboarding.startedAt': { $gte: prevStart, $lte: prevEnd } },
        { 'onboarding.startedAt': { $exists: false }, createdAt: { $gte: prevStart, $lte: prevEnd } }
      ]
    }),
    User.countDocuments({
      ...baseMatch,
      onboardingCompleted: true,
      $or: [
        { 'onboarding.completedAt': { $gte: prevStart, $lte: prevEnd } },
        { 'onboarding.completedAt': { $exists: false }, 'preferences.completedAt': { $gte: prevStart, $lte: prevEnd } }
      ]
    }),
    // Count users who reached each step (used `lastStep` as the watermark).
    User.aggregate([
      { $match: startedMatch },
      {
        $group: {
          _id: null,
          s1: { $sum: { $cond: [{ $gte: ['$onboarding.lastStep', 1] }, 1, 0] } },
          s2: { $sum: { $cond: [{ $gte: ['$onboarding.lastStep', 2] }, 1, 0] } },
          s3: { $sum: { $cond: [{ $gte: ['$onboarding.lastStep', 3] }, 1, 0] } },
          s4: { $sum: { $cond: [{ $gte: ['$onboarding.lastStep', 4] }, 1, 0] } },
          s5: { $sum: { $cond: [{ $gte: ['$onboarding.lastStep', 5] }, 1, 0] } },
          s6: { $sum: { $cond: [{ $gte: ['$onboarding.lastStep', 6] }, 1, 0] } },
          s7: { $sum: { $cond: [{ $gte: ['$onboarding.lastStep', 7] }, 1, 0] } },
          s8: { $sum: { $cond: [{ $gte: ['$onboarding.lastStep', 8] }, 1, 0] } }
        }
      }
    ]),
    User.aggregate([
      { $match: completedMatch },
      {
        $project: {
          duration: {
            $subtract: [
              { $ifNull: ['$onboarding.completedAt', '$preferences.completedAt'] },
              { $ifNull: ['$onboarding.startedAt', '$createdAt'] }
            ]
          }
        }
      },
      { $match: { duration: { $gt: 0 } } },
      { $group: { _id: null, avgMs: { $avg: '$duration' }, samples: { $sum: 1 } } }
    ]),
    User.aggregate([
      { $match: { ...completedMatch, 'onboarding.device': { $ne: null } } },
      { $group: { _id: '$onboarding.device', count: { $sum: 1 } } }
    ]),
    User.countDocuments({ ...baseMatch, 'onboarding.paywall.reachedAt': { $gte: start, $lte: end } }),
    User.aggregate([
      { $match: { ...baseMatch, 'onboarding.paywall.actionAt': { $gte: start, $lte: end } } },
      { $group: { _id: '$onboarding.paywall.action', count: { $sum: 1 } } }
    ]),
    User.aggregate([
      { $match: completedMatch },
      {
        $group: {
          _id: {
            y: { $year: { $ifNull: ['$onboarding.completedAt', '$preferences.completedAt'] } },
            m: { $month: { $ifNull: ['$onboarding.completedAt', '$preferences.completedAt'] } },
            d: { $dayOfMonth: { $ifNull: ['$onboarding.completedAt', '$preferences.completedAt'] } }
          },
          completed: { $sum: 1 }
        }
      }
    ]),
    User.countDocuments({ ...completedMatch, 'onboarding.device': { $in: ['mobile_app', 'mobile_web'] } }),
    User.countDocuments({ ...startedMatch, 'onboarding.device': { $in: ['mobile_app', 'mobile_web'] } }),
    User.countDocuments({
      ...baseMatch,
      onboardingCompleted: true,
      'onboarding.device': { $in: ['mobile_app', 'mobile_web'] },
      $or: [
        { 'onboarding.completedAt': { $gte: prevStart, $lte: prevEnd } },
        { 'onboarding.completedAt': { $exists: false }, 'preferences.completedAt': { $gte: prevStart, $lte: prevEnd } }
      ]
    }),
    User.countDocuments({
      ...baseMatch,
      'onboarding.device': { $in: ['mobile_app', 'mobile_web'] },
      $or: [
        { 'onboarding.startedAt': { $gte: prevStart, $lte: prevEnd } },
        { 'onboarding.startedAt': { $exists: false }, createdAt: { $gte: prevStart, $lte: prevEnd } }
      ]
    })
  ]);

  // ----- Stat cards -----
  const completionRate = pct(completed, started);
  const avgMs = durationsAgg[0]?.avgMs || 0;

  // ----- Funnel -----
  const sc = stepCounts[0] || { s1: 0, s2: 0, s3: 0, s4: 0, s5: 0, s6: 0, s7: 0, s8: 0 };
  const signedUp = started;
  const funnelValues = [
    { label: 'Users Signed Up', value: signedUp },
    { label: 'Started Onboarding', value: signedUp },
    { label: 'Completed Step 1', value: sc.s1 },
    { label: 'Completed Step 2', value: sc.s2 },
    { label: 'Completed Step 3', value: sc.s3 },
    { label: 'Viewed Recommendations', value: sc.s8 },     // step 8 reached = recommendations seen
    { label: 'Viewed Paywall', value: paywallReached },
    { label: 'Completed Payment', value: (paywallActionAgg.find((x) => x._id === 'payment_completed')?.count) || 0 }
  ];
  const funnelTop = funnelValues[0].value || 1;
  const funnel = funnelValues.map((f) => ({
    ...f,
    pct: pct(f.value, funnelTop)
  }));

  // ----- Drop-off table (per step) -----
  const stepArr = [sc.s1, sc.s2, sc.s3, sc.s4, sc.s5, sc.s6, sc.s7, sc.s8];
  const dropOff = STEP_LABELS.map((label, i) => {
    const enteredStep = i === 0 ? started : stepArr[i - 1]; // people who had completed prior step
    const completedStep = stepArr[i];
    const dropUsers = Math.max(0, enteredStep - completedStep);
    return {
      step: label,
      users: dropUsers,
      rate: pct(dropUsers, enteredStep || 1)
    };
  });

  // ----- Completion over time -----
  // Bucket per day across the range and report % completion of that day's
  // *starters*. For a single day range, we still emit one bucket.
  const days = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  // Need starters per day to compute % — fetch separately.
  const starterByDay = await User.aggregate([
    { $match: startedMatch },
    {
      $group: {
        _id: {
          y: { $year: { $ifNull: ['$onboarding.startedAt', '$createdAt'] } },
          m: { $month: { $ifNull: ['$onboarding.startedAt', '$createdAt'] } },
          d: { $dayOfMonth: { $ifNull: ['$onboarding.startedAt', '$createdAt'] } }
        },
        started: { $sum: 1 }
      }
    }
  ]);

  const keyFor = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const startedMap = new Map(starterByDay.map((b) => [`${b._id.y}-${b._id.m}-${b._id.d}`, b.started]));
  const completedMap = new Map(completionByDay.map((b) => [`${b._id.y}-${b._id.m}-${b._id.d}`, b.completed]));

  const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const completionTimeline = days.map((d) => {
    const k = keyFor(d);
    const s = startedMap.get(k) || 0;
    const c = completedMap.get(k) || 0;
    const label = days.length <= 7 ? DOW[d.getDay()] : `${d.getMonth() + 1}/${d.getDate()}`;
    return { date: d.toISOString(), label, started: s, completed: c, completionRate: pct(c, s) };
  });

  // ----- Paywall donut -----
  const paywallCountByAction = new Map(paywallActionAgg.map((x) => [x._id, x.count]));
  const paywallTotal = paywallReached || 0;
  const paywall = ['wallet_selected', 'subscription_selected', 'payment_completed', 'abandoned'].map((a) => {
    const value = paywallCountByAction.get(a) || 0;
    return {
      action: a,
      label: PAYWALL_LABELS[a],
      color: PAYWALL_COLORS[a],
      value,
      pct: pct(value, paywallTotal)
    };
  });

  // ----- Device donut -----
  const deviceCountByKind = new Map(deviceAgg.map((x) => [x._id, x.count]));
  const deviceTotal = ['mobile_app', 'mobile_web', 'desktop'].reduce(
    (acc, k) => acc + (deviceCountByKind.get(k) || 0),
    0
  );
  const devices = ['mobile_app', 'mobile_web', 'desktop'].map((k) => {
    const value = deviceCountByKind.get(k) || 0;
    return {
      device: k,
      label: DEVICE_LABELS[k],
      color: DEVICE_COLORS[k],
      value,
      pct: pct(value, deviceTotal)
    };
  });

  const mobileRate = pct(mobileCompleted, mobileStarted);
  const prevMobileRate = pct(prevMobileCompleted, prevMobileStarted);
  const mobileDelta = round1(mobileRate - prevMobileRate);

  // Range label like "May 07 - May 13, 2026"
  const dateRangeLabel =
    formatLabel(start).split(',')[0] +
    ' - ' +
    formatLabel(end);

  return sendResponse(res, {
    data: {
      range: { key, start, end, label: dateRangeLabel },
      stats: {
        started,
        completed,
        completionRate,
        avgCompletionMs: Math.round(avgMs),
        avgCompletionLabel: formatDuration(avgMs),
        deltas: {
          startedAbs: started - prevStarted,
          completedAbs: completed - prevCompleted,
          completionRatePct: round1(completionRate - pct(prevCompleted, prevStarted))
        }
      },
      funnel,
      completionTimeline,
      dropOff,
      paywall: {
        totalReached: paywallTotal,
        breakdown: paywall
      },
      devices: {
        totalCompleted: deviceTotal,
        breakdown: devices,
        mobileCompletionRate: mobileRate,
        mobileCompletionDelta: mobileDelta
      }
    }
  });
});
