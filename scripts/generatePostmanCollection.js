import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(__dirname, '..', 'postman', 'Prophetic_Pathway_API.postman_collection.json');

const schema = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
const base = '{{baseUrl}}';

const tokenCaptureTest = (tokenVar = 'accessToken') => `
const json = pm.response.json();
if (json && json.data) {
  if (json.data.accessToken) pm.collectionVariables.set("${tokenVar}", json.data.accessToken);
  if (json.data.refreshToken) pm.collectionVariables.set("refreshToken", json.data.refreshToken);
  if (json.data.resetToken) pm.collectionVariables.set("resetToken", json.data.resetToken);
  if (json.data.user && json.data.user._id) {
    pm.collectionVariables.set("currentUserId", json.data.user._id);
    if (json.data.user.role === "advisor") pm.collectionVariables.set("advisorId", json.data.user._id);
    if (json.data.user.role === "admin") pm.collectionVariables.set("adminId", json.data.user._id);
  }
}`;

const checkoutCaptureTest = (idKey, varName) => `
const json = pm.response.json();
if (json && json.data) {
  if (json.data.${idKey}) pm.collectionVariables.set("${varName}", json.data.${idKey});
  if (json.data.sessionId) pm.collectionVariables.set("stripeSessionId", json.data.sessionId);
}`;

function parsePath(path) {
  const [pathname, search = ''] = path.split('?');
  const query = new URLSearchParams(search);
  return {
    pathname,
    query: Array.from(query.entries()).map(([key, value]) => ({ key, value }))
  };
}

function urlFor(path, explicitQuery = []) {
  const { pathname, query } = parsePath(path);
  const allQuery = [...query, ...explicitQuery];
  const queryString = allQuery.length
    ? `?${allQuery.map((q) => `${q.key}=${q.value ?? ''}`).join('&')}`
    : '';

  return {
    raw: `${base}${pathname}${queryString}`,
    host: [base],
    path: pathname.replace(/^\//, '').split('/'),
    query: allQuery.map((q) => ({
      key: q.key,
      value: String(q.value ?? ''),
      description: q.description || '',
      disabled: q.disabled || false
    }))
  };
}

function jsonBody(payload) {
  return {
    mode: 'raw',
    raw: JSON.stringify(payload, null, 2),
    options: { raw: { language: 'json' } }
  };
}

function formBody(fields) {
  return {
    mode: 'formdata',
    formdata: fields.map((field) => {
      if (field.type === 'file') {
        return {
          key: field.key,
          type: 'file',
          src: field.src || [],
          description: field.description || ''
        };
      }
      return {
        key: field.key,
        type: 'text',
        value: typeof field.value === 'string' ? field.value : JSON.stringify(field.value),
        description: field.description || ''
      };
    })
  };
}

function item(name, method, path, options = {}) {
  const request = {
    method,
    header: [],
    url: urlFor(path, options.query),
    description: options.description || ''
  };

  if (options.auth === 'noauth') {
    request.auth = { type: 'noauth' };
  }

  if (options.body) {
    request.body = options.body;
    if (options.body.mode === 'raw') {
      request.header.push({ key: 'Content-Type', value: 'application/json' });
    }
  }

  const out = { name, request, response: [] };
  if (options.tests) {
    out.event = [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: options.tests.trim().split('\n')
        }
      }
    ];
  }
  return out;
}

function folder(name, description, items) {
  return {
    name,
    description,
    item: items
  };
}

const collection = {
  info: {
    name: 'Prophetic Pathway API',
    description: [
      'Full frontend-friendly Postman collection for the Prophetic Pathway backend.',
      '',
      'How to use:',
      '1. Set `baseUrl` to your running backend, usually `http://localhost:5000`.',
      '2. Run an auth request. Login and OTP verification save `accessToken` and `refreshToken` automatically.',
      '3. Replace placeholder IDs such as `{{advisorId}}`, `{{sessionId}}`, and `{{planId}}` from previous API responses.',
      '4. Requests that upload files use form-data and leave file fields empty for you to choose in Postman.',
      '',
      'Protected requests inherit Bearer auth from the collection: `Authorization: Bearer {{accessToken}}`.',
      '',
      'Mobile auth flow:',
      '  Signup -> Verify Signup OTP (returns tokens) -> Onboarding - Submit Preferences -> List Public Plans -> Subscribe To Plan By Tier.',
      'Forgot-password flow:',
      '  Forgot Password - Send OTP -> Verify Reset OTP (returns `resetToken`) -> Reset Password.'
    ].join('\n'),
    schema
  },
  auth: {
    type: 'bearer',
    bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }]
  },
  variable: [
    { key: 'baseUrl', value: 'http://localhost:5000' },
    { key: 'accessToken', value: '' },
    { key: 'refreshToken', value: '' },
    { key: 'resetToken', value: '' },
    { key: 'currentUserId', value: '' },
    { key: 'adminId', value: '' },
    { key: 'advisorId', value: '' },
    { key: 'sessionId', value: '' },
    { key: 'chatId', value: '' },
    { key: 'planId', value: '' },
    { key: 'planTier', value: 'clarity' },
    { key: 'subscriptionId', value: '' },
    { key: 'txId', value: '' },
    { key: 'stripeSessionId', value: '' },
    { key: 'disputeId', value: '' },
    { key: 'complaintId', value: '' },
    { key: 'contactMessageId', value: '' },
    { key: 'reviewId', value: '' },
    { key: 'blogId', value: '' },
    { key: 'faqId', value: '' },
    { key: 'cmsPageSlug', value: 'privacy_policy' },
    { key: 'siteContentSlug', value: 'home' },
    { key: 'notificationId', value: '' },
    { key: 'advisorApplicationId', value: '' },
    { key: 'payoutId', value: '' },
    { key: 'transactionId', value: '' },
    { key: 'subAdminId', value: '' },
    { key: 'cloudinaryPublicId', value: '' },
    { key: 'userEmail', value: 'user@example.com' },
    { key: 'advisorEmail', value: 'advisor@example.com' },
    { key: 'adminEmail', value: 'admin@propheticpathway.com' },
    { key: 'password', value: 'ChangeMe@123' },
    { key: 'otp', value: '1234' }
  ],
  item: [
    folder('00 - System', 'Health and root API checks. These are public.', [
      item('API Root', 'GET', '/', { auth: 'noauth' }),
      item('Health Check', 'GET', '/api/v1/health', { auth: 'noauth' })
    ]),

    folder('01 - Auth', 'Signup, OTP, login, token refresh, password management, and current user.', [
      item('Signup - User', 'POST', '/api/v1/auth/signup', {
        auth: 'noauth',
        body: jsonBody({
          name: 'Frontend User',
          email: '{{userEmail}}',
          phoneNumber: '+15550100001',
          password: '{{password}}',
          confirmPassword: '{{password}}'
        })
      }),
      item('Signup - Advisor', 'POST', '/api/v1/auth/advisor/signup', {
        auth: 'noauth',
        body: jsonBody({
          name: 'Frontend Advisor',
          email: '{{advisorEmail}}',
          phoneNumber: '+15550100002',
          password: '{{password}}',
          confirmPassword: '{{password}}',
          professionalTitle: 'Spiritual Advisor',
          bio: 'Short advisor bio for profile cards.',
          detailedDescription: 'Longer advisor profile description.',
          yearsOfExperience: '5',
          expertise: ['Tarot', 'Life Guidance'],
          styles: ['Compassionate', 'Direct'],
          languages: ['English'],
          pricing: { chatPerMin: 1, callPerMin: 1.2, videoPerMin: 1.5 },
          preRecordedAnswers: [
            { question: 'How do you guide clients?', answer: 'With clarity and care.' }
          ]
        })
      }),
      item('Advisor Apply - Website Modal', 'POST', '/api/v1/auth/advisor-apply', {
        auth: 'noauth',
        description: 'Multipart endpoint used by the public Join as Advisor modal. Creates/updates an advisor user and application, uploads optional profile photo and intro video, then sends verification OTP.',
        body: formBody([
          { key: 'name', value: 'Frontend Advisor' },
          { key: 'email', value: '{{advisorEmail}}' },
          { key: 'phone', value: '+15550100002' },
          { key: 'password', value: '{{password}}' },
          { key: 'confirmPassword', value: '{{password}}' },
          { key: 'dateOfBirth', value: '1990-01-01' },
          { key: 'address', value: '123 Main Street' },
          { key: 'city', value: 'Austin' },
          { key: 'zip', value: '73301' },
          { key: 'country', value: 'USA' },
          { key: 'yearsOfExperience', value: '5' },
          { key: 'bio', value: 'Short advisor application bio.' },
          { key: 'expertise', value: 'Tarot,Life Guidance' },
          { key: 'styles', value: 'Compassionate,Direct' },
          { key: 'languages', value: 'English' },
          { key: 'introVideo', type: 'file', description: 'Optional intro video.' },
          { key: 'profilePhoto', type: 'file', description: 'Optional profile image.' }
        ]),
        tests: `
const json = pm.response.json();
if (json && json.data) {
  if (json.data.user && json.data.user._id) pm.collectionVariables.set("advisorId", json.data.user._id);
  if (json.data.application && json.data.application._id) pm.collectionVariables.set("advisorApplicationId", json.data.application._id);
}`
      }),
      item('Verify Signup OTP', 'POST', '/api/v1/auth/verify-otp', {
        auth: 'noauth',
        body: jsonBody({ email: '{{userEmail}}', otp: '{{otp}}' }),
        tests: tokenCaptureTest()
      }),
      item('Verify Reset OTP', 'POST', '/api/v1/auth/verify-otp', {
        auth: 'noauth',
        body: jsonBody({ email: '{{userEmail}}', otp: '{{otp}}' }),
        tests: tokenCaptureTest()
      }),
      item('Resend OTP', 'POST', '/api/v1/auth/resend-otp', {
        auth: 'noauth',
        body: jsonBody({ email: '{{userEmail}}', purpose: 'verify' })
      }),
      item('Login - User', 'POST', '/api/v1/auth/login', {
        auth: 'noauth',
        body: jsonBody({ email: '{{userEmail}}', password: '{{password}}' }),
        tests: tokenCaptureTest('accessToken')
      }),
      item('Login - Advisor', 'POST', '/api/v1/auth/login', {
        auth: 'noauth',
        body: jsonBody({ email: '{{advisorEmail}}', password: '{{password}}' }),
        tests: tokenCaptureTest('accessToken')
      }),
      item('Login - Admin', 'POST', '/api/v1/auth/login', {
        auth: 'noauth',
        body: jsonBody({ email: '{{adminEmail}}', password: '{{password}}' }),
        tests: tokenCaptureTest('accessToken')
      }),
      item('Forgot Password - Send OTP', 'POST', '/api/v1/auth/forgot-password', {
        auth: 'noauth',
        body: jsonBody({ email: '{{userEmail}}' })
      }),
      item('Reset Password', 'POST', '/api/v1/auth/reset-password', {
        auth: 'noauth',
        body: jsonBody({
          resetToken: '{{resetToken}}',
          newPassword: '{{password}}',
          confirmPassword: '{{password}}'
        })
      }),
      item('Refresh Token', 'POST', '/api/v1/auth/refresh', {
        auth: 'noauth',
        body: jsonBody({ refreshToken: '{{refreshToken}}' }),
        tests: tokenCaptureTest()
      }),
      item('Change Password', 'POST', '/api/v1/auth/change-password', {
        body: jsonBody({
          currentPassword: '{{password}}',
          newPassword: '{{password}}',
          confirmPassword: '{{password}}'
        })
      }),
      item('Me', 'GET', '/api/v1/auth/me')
    ]),

    folder('02 - Public Advisors', 'Public browse/search endpoints used by frontend discovery screens.', [
      item('Featured Advisors', 'GET', '/api/v1/advisors/featured?page=1&limit=10', { auth: 'noauth' }),
      item('Top Rated Advisors', 'GET', '/api/v1/advisors/top-rated?page=1&limit=10', { auth: 'noauth' }),
      item('Search Advisors', 'GET', '/api/v1/advisors/search?q=tarot&expertise=Tarot&styles=Compassionate&languages=English&availableNow=false&sortBy=rating&page=1&limit=10', { auth: 'noauth' }),
      item('Advisor Details', 'GET', '/api/v1/advisors/{{advisorId}}', { auth: 'noauth' })
    ]),

    folder('03 - User', 'Authenticated user profile, preferences, FCM token, deactivation, and favorites.', [
      item('Onboarding - Get Questions (public)', 'GET', '/api/v1/users/onboarding/questions', {
        auth: 'noauth',
        description: 'Public endpoint used to render the 8-step onboarding questionnaire.'
      }),
      item('Onboarding - Get My Preferences', 'GET', '/api/v1/users/preferences'),
      item('Onboarding - Submit Preferences', 'PUT', '/api/v1/users/preferences', {
        body: jsonBody({
          seekingHelpWith: ['Love & Relationships', 'Career'],
          guidanceType: 'Tarot Reading',
          connectionMethods: ['Text', 'Video Call'],
          atmosphere: 'Warm and compassionate',
          guidanceFrequency: 'Weekly',
          tailoredAreas: ['Spiritual Growth'],
          guideQualityPriority: 'Accuracy',
          usedPlatformBefore: false
        })
      }),
      item('Get Profile', 'GET', '/api/v1/users/profile'),
      item('Update Profile', 'PATCH', '/api/v1/users/profile', {
        body: formBody([
          { key: 'name', value: 'Frontend User' },
          { key: 'phone', value: '+15550100001' },
          { key: 'location', value: 'New York, USA' },
          { key: 'timezone', value: 'America/New_York' },
          { key: 'language', value: 'English' },
          { key: 'profilePhoto', type: 'file', description: 'Optional image file.' }
        ])
      }),
      item('Update Notification Preferences', 'PATCH', '/api/v1/users/notification-prefs', {
        body: jsonBody({ email: true, newSessions: true, newMessages: true, paymentUpdates: true, push: true })
      }),
      item('Register FCM Token', 'POST', '/api/v1/users/fcm-tokens', {
        body: jsonBody({ token: 'firebase-device-token' })
      }),
      item('Remove FCM Token', 'DELETE', '/api/v1/users/fcm-tokens', {
        body: jsonBody({ token: 'firebase-device-token' })
      }),
      item('Deactivate Account', 'POST', '/api/v1/users/deactivate'),
      item('Add Favorite Advisor', 'POST', '/api/v1/users/favorites/{{advisorId}}'),
      item('Remove Favorite Advisor', 'DELETE', '/api/v1/users/favorites/{{advisorId}}'),
      item('List Favorites', 'GET', '/api/v1/users/favorites')
    ]),

    folder('04 - Advisor Self Service', 'Advisor-only profile, application, availability, dashboard, and promotion operations.', [
      item('Get My Application', 'GET', '/api/v1/advisor/application'),
      item('Update My Application', 'PATCH', '/api/v1/advisor/application', {
        body: jsonBody({
          professionalTitle: 'Spiritual Advisor',
          bio: 'Updated profile card bio.',
          detailedDescription: 'Detailed profile content for frontend details page.',
          yearsOfExperience: '7',
          expertise: ['Tarot', 'Dream Interpretation'],
          styles: ['Compassionate', 'Practical'],
          languages: ['English', 'Spanish'],
          pricing: { chatPerMin: 1, callPerMin: 1.2, videoPerMin: 1.5 },
          preRecordedAnswers: [{ question: 'What is your method?', answer: 'I start by listening carefully.' }]
        })
      }),
      item('Upload Intro Video', 'POST', '/api/v1/advisor/application/intro-video', {
        body: formBody([{ key: 'video', type: 'file', description: 'Required video file.' }])
      }),
      item('Get My Profile', 'GET', '/api/v1/advisor/profile'),
      item('Update My Profile', 'PATCH', '/api/v1/advisor/profile', {
        body: jsonBody({
          name: 'Frontend Advisor',
          phone: '+15550100002',
          location: 'Austin, USA',
          language: 'English',
          timezone: 'America/Chicago',
          professionalTitle: 'Spiritual Advisor',
          bio: 'Short public bio.',
          detailedDescription: 'Long public bio.',
          yearsOfExperience: '7',
          expertise: ['Tarot', 'Life Guidance'],
          styles: ['Warm', 'Direct'],
          languages: ['English'],
          pricing: { chatPerMin: 1, callPerMin: 1.2, videoPerMin: 1.5 },
          autoOnlineMode: true,
          weeklySchedule: {
            monday: { enabled: true, from: '09:00', to: '18:00' },
            tuesday: { enabled: true, from: '09:00', to: '18:00' }
          }
        })
      }),
      item('Upload Profile Photo', 'POST', '/api/v1/advisor/profile/photo', {
        body: formBody([{ key: 'photo', type: 'file', description: 'Required image file.' }])
      }),
      item('Set Online Mode', 'PATCH', '/api/v1/advisor/profile/online', {
        body: jsonBody({ isOnline: true })
      }),
      item('Dashboard', 'GET', '/api/v1/advisor/dashboard'),
      item('Performance', 'GET', '/api/v1/advisor/performance'),
      item('Promotion Plans', 'GET', '/api/v1/advisor/promotion-plans'),
      item('Activate Promotion', 'POST', '/api/v1/advisor/promotion/activate', {
        body: jsonBody({ plan: 'basic' })
      })
    ]),

    folder('05 - Sessions', 'Authenticated booking, LiveKit, lifecycle, billing heartbeat, cancellation, reschedule, tips, and notes.', [
      item('Book Session', 'POST', '/api/v1/sessions/book', {
        body: jsonBody({
          advisorId: '{{advisorId}}',
          type: 'chat',
          scheduledFor: '2026-05-10T14:00:00.000Z',
          durationMinutes: 15,
          instantStart: false
        }),
        tests: `
const json = pm.response.json();
if (json && json.data && json.data._id) pm.collectionVariables.set("sessionId", json.data._id);`
      }),
      item('My User Sessions', 'GET', '/api/v1/sessions/mine/user?tab=all&page=1&limit=10'),
      item('My Advisor Sessions', 'GET', '/api/v1/sessions/mine/advisor?tab=live&page=1&limit=10'),
      item('Advisor Calendar', 'GET', '/api/v1/sessions/mine/calendar?from=2026-05-01&to=2026-05-31'),
      item('Ongoing Session', 'GET', '/api/v1/sessions/ongoing'),
      item('Session Details', 'GET', '/api/v1/sessions/{{sessionId}}'),
      item('Session Summary', 'GET', '/api/v1/sessions/{{sessionId}}/summary'),
      item('Consent Recording', 'POST', '/api/v1/sessions/{{sessionId}}/consent'),
      item('Get LiveKit Token', 'POST', '/api/v1/sessions/{{sessionId}}/livekit-token'),
      item('Advisor Start Session', 'POST', '/api/v1/sessions/{{sessionId}}/advisor/start'),
      item('End Session', 'POST', '/api/v1/sessions/{{sessionId}}/end'),
      item('Session Heartbeat', 'POST', '/api/v1/sessions/{{sessionId}}/heartbeat'),
      item('Extend Session', 'POST', '/api/v1/sessions/{{sessionId}}/extend', {
        body: jsonBody({ minutes: 5 })
      }),
      item('Cancel Session', 'POST', '/api/v1/sessions/{{sessionId}}/cancel', {
        body: jsonBody({ reason: 'Client requested cancellation.' })
      }),
      item('Reschedule Session', 'POST', '/api/v1/sessions/{{sessionId}}/reschedule', {
        body: jsonBody({ newScheduledFor: '2026-05-11T14:00:00.000Z', reason: 'Need another time.' })
      }),
      item('Tip Advisor', 'POST', '/api/v1/sessions/{{sessionId}}/tip', {
        body: jsonBody({ amount: 5 })
      }),
      item('Unlock Session Asset', 'POST', '/api/v1/sessions/{{sessionId}}/unlock', {
        body: jsonBody({ asset: 'recording' })
      }),
      item('Save Advisor Notes', 'POST', '/api/v1/sessions/{{sessionId}}/notes', {
        body: jsonBody({ notes: 'Private advisor note for this session.' })
      })
    ]),

    folder('06 - Wallet & Payments', 'Wallet balance, transactions, Stripe checkout redirect success/cancel, advisor earnings, and withdrawals.', [
      item('My Wallet', 'GET', '/api/v1/wallet/me'),
      item('My Transactions', 'GET', '/api/v1/wallet/transactions?type=wallet_topup&page=1&limit=10'),
      item('Create Top-up Checkout', 'POST', '/api/v1/wallet/topup', {
        body: jsonBody({ amount: 25 }),
        tests: checkoutCaptureTest('txId', 'txId')
      }),
      item('Top-up Success Redirect', 'GET', '/api/v1/wallet/topup/success?txId={{txId}}&session_id={{stripeSessionId}}', { auth: 'noauth' }),
      item('Top-up Cancel Redirect', 'GET', '/api/v1/wallet/topup/cancel?txId={{txId}}', { auth: 'noauth' }),
      item('Advisor Earnings Overview', 'GET', '/api/v1/wallet/advisor/overview'),
      item('Advisor Earnings History', 'GET', '/api/v1/wallet/advisor/earnings?range=week&page=1&limit=10'),
      item('Advisor Withdrawals History', 'GET', '/api/v1/wallet/advisor/withdrawals?page=1&limit=10'),
      item('Request Advisor Withdrawal', 'POST', '/api/v1/wallet/advisor/withdraw', {
        body: jsonBody({ amount: 50 })
      }),
      item('Archive Earning Record', 'DELETE', '/api/v1/wallet/advisor/earnings/{{transactionId}}'),
      item('Archive Withdrawal Record', 'DELETE', '/api/v1/wallet/advisor/withdrawals/{{transactionId}}')
    ]),

    folder('07 - Subscriptions', 'Public plan listing, authenticated subscribe/cancel, and Stripe redirect routes.', [
      item('List Public Plans', 'GET', '/api/v1/subscriptions/plans', {
        auth: 'noauth',
        tests: `
const json = pm.response.json();
if (json && Array.isArray(json.data)) {
  const tier = pm.collectionVariables.get("planTier") || "clarity";
  const plan = json.data.find((p) => p.tier === tier) || json.data[0];
  if (plan && plan._id) pm.collectionVariables.set("planId", plan._id);
}`
      }),
      item('My Active Subscription', 'GET', '/api/v1/subscriptions/me'),
      item('Subscribe To Plan', 'POST', '/api/v1/subscriptions/subscribe', {
        body: jsonBody({ planId: '{{planId}}' }),
        tests: checkoutCaptureTest('subId', 'subscriptionId')
      }),
      item('Subscribe To Plan By Tier', 'POST', '/api/v1/subscriptions/subscribe', {
        body: jsonBody({ tier: '{{planTier}}' }),
        tests: checkoutCaptureTest('subId', 'subscriptionId')
      }),
      item('Subscription Success Redirect', 'GET', '/api/v1/subscriptions/checkout/success?subId={{subscriptionId}}&session_id={{stripeSessionId}}', { auth: 'noauth' }),
      item('Subscription Cancel Redirect', 'GET', '/api/v1/subscriptions/checkout/cancel?subId={{subscriptionId}}', { auth: 'noauth' }),
      item('Cancel My Subscription', 'POST', '/api/v1/subscriptions/cancel')
    ]),

    folder('08 - Disputes', 'Authenticated user dispute flow. Creation supports up to five document uploads.', [
      item('Open Dispute', 'POST', '/api/v1/disputes', {
        body: formBody([
          { key: 'sessionId', value: '{{sessionId}}' },
          { key: 'disputeType', value: 'overcharged' },
          { key: 'details', value: 'Describe what happened.' },
          { key: 'expectedResolution', value: 'partial_refund' },
          { key: 'documents', type: 'file', description: 'Optional document file. Add more rows with key documents for multiple files.' }
        ]),
        tests: `
const json = pm.response.json();
if (json && json.data && json.data._id) pm.collectionVariables.set("disputeId", json.data._id);`
      }),
      item('List My Disputes', 'GET', '/api/v1/disputes?status=open&page=1&limit=10'),
      item('Get Dispute', 'GET', '/api/v1/disputes/{{disputeId}}'),
      item('Cancel Dispute', 'POST', '/api/v1/disputes/{{disputeId}}/cancel')
    ]),

    folder('09 - Complaints & Safety', 'Authenticated complaint and safety reporting flows with optional documents.', [
      item('File Complaint', 'POST', '/api/v1/complaints/complain', {
        body: formBody([
          { key: 'issueType', value: 'service_quality' },
          { key: 'description', value: 'Describe the complaint.' },
          { key: 'sessionId', value: '{{sessionId}}' },
          { key: 'advisorId', value: '{{advisorId}}' },
          { key: 'documents', type: 'file', description: 'Optional document file.' }
        ]),
        tests: `
const json = pm.response.json();
if (json && json.data && json.data._id) pm.collectionVariables.set("complaintId", json.data._id);`
      }),
      item('File Safety Report', 'POST', '/api/v1/complaints/safety', {
        body: formBody([
          { key: 'issueType', value: 'harassment' },
          { key: 'description', value: 'Describe the safety issue.' },
          { key: 'sessionId', value: '{{sessionId}}' },
          { key: 'advisorId', value: '{{advisorId}}' },
          { key: 'documents', type: 'file', description: 'Optional document file.' }
        ])
      }),
      item('My Complaints', 'GET', '/api/v1/complaints/mine?kind=complain&page=1&limit=10')
    ]),

    folder('10 - Reviews', 'Public review lists and authenticated session review submission.', [
      item('Showcase Reviews', 'GET', '/api/v1/reviews/showcase', { auth: 'noauth' }),
      item('Featured Testimonials', 'GET', '/api/v1/reviews/featured-testimonials', {
        auth: 'noauth',
        description: 'Public homepage testimonials curated by admin.'
      }),
      item('Advisor Reviews', 'GET', '/api/v1/reviews/advisor/{{advisorId}}?page=1&limit=10', { auth: 'noauth' }),
      item('Submit Review', 'POST', '/api/v1/reviews', {
        body: jsonBody({
          sessionId: '{{sessionId}}',
          rating: 5,
          breakdown: {
            accuracy: 5,
            clarity: 5,
            helpfulness: 5,
            valuable: 5,
            communication: 5,
            professionalism: 5,
            valueForMoney: 5,
            expertise: 5
          },
          comment: 'Helpful and clear session.'
        }),
        tests: `
const json = pm.response.json();
if (json && json.data && json.data._id) pm.collectionVariables.set("reviewId", json.data._id);`
      })
    ]),

    folder('11 - CMS', 'Public CMS reads plus admin CMS, FAQ, page, and blog management.', [
      item('List Blogs', 'GET', '/api/v1/cms/blogs?type=Meditation%20%26%20Mindfulness&page=1&limit=10', { auth: 'noauth' }),
      item('Get Blog', 'GET', '/api/v1/cms/blogs/{{blogId}}', { auth: 'noauth' }),
      item('List FAQs', 'GET', '/api/v1/cms/faqs', { auth: 'noauth' }),
      item('Get CMS Page By Slug', 'GET', '/api/v1/cms/pages/{{cmsPageSlug}}', { auth: 'noauth' }),
      item('Get CMS Page', 'GET', '/api/v1/cms/pages/privacy_policy', { auth: 'noauth' }),
      item('Get Terms CMS Page', 'GET', '/api/v1/cms/pages/terms_of_service', { auth: 'noauth' }),
      item('List Site Content Pages', 'GET', '/api/v1/cms/site-content', {
        auth: 'noauth',
        description: 'Public/admin helper for listing all per-page marketing content documents.'
      }),
      item('Get Site Content Page', 'GET', '/api/v1/cms/site-content/{{siteContentSlug}}', {
        auth: 'noauth',
        description: 'Public endpoint used by the marketing website for page sections.'
      }),
      item('Admin Create Blog', 'POST', '/api/v1/cms/blogs', {
        body: formBody([
          { key: 'authorName', value: 'Admin Author' },
          { key: 'authorTitle', value: 'Editorial Team' },
          { key: 'type', value: 'Meditation & Mindfulness' },
          { key: 'title', value: 'How to Prepare for a Session' },
          { key: 'excerpt', value: 'Short preview text.' },
          { key: 'content', value: 'Full article content.' },
          { key: 'readMinutes', value: '6' },
          { key: 'isPublished', value: 'true' },
          { key: 'profile', type: 'file', description: 'Optional author image.' },
          { key: 'thumbnail', type: 'file', description: 'Optional blog thumbnail.' }
        ])
      }),
      item('Admin Update Blog', 'PATCH', '/api/v1/cms/blogs/{{blogId}}', {
        body: formBody([
          { key: 'title', value: 'Updated Blog Title' },
          { key: 'excerpt', value: 'Updated preview text.' },
          { key: 'content', value: 'Updated article content.' },
          { key: 'isPublished', value: 'true' },
          { key: 'profile', type: 'file', description: 'Optional author image.' },
          { key: 'thumbnail', type: 'file', description: 'Optional thumbnail.' }
        ])
      }),
      item('Admin Delete Blog', 'DELETE', '/api/v1/cms/blogs/{{blogId}}'),
      item('Admin List FAQs', 'GET', '/api/v1/cms/admin/faqs'),
      item('Admin Create FAQ', 'POST', '/api/v1/cms/faqs', {
        body: jsonBody({ question: 'How do sessions work?', answer: 'Users book advisors and connect live.', sortOrder: 1, isActive: true })
      }),
      item('Admin Update FAQ', 'PATCH', '/api/v1/cms/faqs/{{faqId}}', {
        body: jsonBody({ question: 'Updated question?', answer: 'Updated answer.', sortOrder: 2, isActive: true })
      }),
      item('Admin Delete FAQ', 'DELETE', '/api/v1/cms/faqs/{{faqId}}'),
      item('Admin Upsert CMS Page By Slug', 'PUT', '/api/v1/cms/pages/{{cmsPageSlug}}', {
        body: jsonBody({ title: 'Privacy Policy', content: 'Page content goes here.' })
      }),
      item('Admin Upsert CMS Page', 'PUT', '/api/v1/cms/pages/privacy_policy', {
        body: jsonBody({ title: 'Privacy Policy', content: 'Page content goes here.' })
      }),
      item('Admin Upsert Terms CMS Page', 'PUT', '/api/v1/cms/pages/terms_of_service', {
        body: jsonBody({ title: 'Terms of Service', content: 'Terms content goes here.' })
      }),
      item('Admin Upsert Site Content Page', 'PUT', '/api/v1/cms/site-content/{{siteContentSlug}}', {
        body: jsonBody({
          pageName: 'Home',
          sections: {}
        })
      }),
      item('Admin Upload Site Content Media', 'POST', '/api/v1/cms/site-content/{{siteContentSlug}}/upload', {
        body: formBody([
          { key: 'sectionKey', value: 'hero' },
          { key: 'file', type: 'file', description: 'Image or video file used by CMS sections.' }
        ])
      })
    ]),

    folder('12 - Contact', 'Public contact form plus admin inbox management.', [
      item('Contact Metadata', 'GET', '/api/v1/contact/meta', {
        auth: 'noauth',
        description: 'Public helper returning allowed categories and admin statuses.'
      }),
      item('Submit Contact Message', 'POST', '/api/v1/contact', {
        auth: 'noauth',
        body: jsonBody({
          firstName: 'Frontend',
          lastName: 'User',
          email: '{{userEmail}}',
          phone: '+15550100001',
          subject: 'Need help',
          category: 'General Inquiry',
          message: 'Hello from the frontend contact form.'
        }),
        tests: `
const json = pm.response.json();
if (json && json.data && json.data.id) pm.collectionVariables.set("contactMessageId", json.data.id);`
      }),
      item('Admin List Contact Messages', 'GET', '/api/v1/contact?status=new&page=1&limit=10'),
      item('Admin Get Contact Message', 'GET', '/api/v1/contact/{{contactMessageId}}'),
      item('Admin Update Contact Message', 'PATCH', '/api/v1/contact/{{contactMessageId}}', {
        body: jsonBody({ status: 'in_progress', adminNote: 'Follow up with this user.' })
      }),
      item('Admin Delete Contact Message', 'DELETE', '/api/v1/contact/{{contactMessageId}}')
    ]),

    folder('13 - Notifications', 'Authenticated notification inbox plus admin broadcast.', [
      item('Notification Summary', 'GET', '/api/v1/notifications/me', {
        description: 'Small topbar helper returning { total, unread }.'
      }),
      item('List Notifications', 'GET', '/api/v1/notifications?unread=true&page=1&limit=10'),
      item('Mark Notification Read', 'PATCH', '/api/v1/notifications/{{notificationId}}/read'),
      item('Mark All Read', 'POST', '/api/v1/notifications/read-all'),
      item('Delete Notification', 'DELETE', '/api/v1/notifications/{{notificationId}}'),
      item('Admin Broadcast', 'POST', '/api/v1/notifications/admin/broadcast', {
        body: jsonBody({
          audience: 'all',
          title: 'Platform update',
          body: 'New feature available.',
          data: { deepLink: '/notifications' }
        })
      })
    ]),

    folder('14 - Chats', 'Authenticated chat discovery, message listing/sending, read receipts, and admin support chat.', [
      item('My Chats', 'GET', '/api/v1/chats/mine'),
      item('Admin List Support Chats', 'GET', '/api/v1/chats/admin?q=Frontend&page=1&limit=10'),
      item('Ensure Session Chat', 'POST', '/api/v1/chats/session/{{sessionId}}', {
        tests: `
const json = pm.response.json();
if (json && json.data && json.data._id) pm.collectionVariables.set("chatId", json.data._id);`
      }),
      item('Ensure Admin Support Chat', 'POST', '/api/v1/chats/admin', {
        tests: `
const json = pm.response.json();
if (json && json.data && json.data._id) pm.collectionVariables.set("chatId", json.data._id);`
      }),
      item('Get Chat', 'GET', '/api/v1/chats/{{chatId}}'),
      item('List Messages', 'GET', '/api/v1/chats/{{chatId}}/messages?page=1&limit=30'),
      item('Send Message', 'POST', '/api/v1/chats/{{chatId}}/messages', {
        body: formBody([
          { key: 'text', value: 'Hello from Postman.' },
          { key: 'attachments', type: 'file', description: 'Optional attachment. Add more rows with key attachments for multiple files.' }
        ])
      }),
      item('Mark Chat Read', 'POST', '/api/v1/chats/{{chatId}}/read')
    ]),

    folder('15 - Uploads', 'Reusable authenticated Cloudinary upload/delete helpers.', [
      item('Upload Image', 'POST', '/api/v1/uploads/image', {
        body: formBody([
          { key: 'folder', value: 'postman-images' },
          { key: 'image', type: 'file', description: 'Required image file.' }
        ])
      }),
      item('Delete Image', 'DELETE', '/api/v1/uploads/image/{{cloudinaryPublicId}}'),
      item('Upload Video', 'POST', '/api/v1/uploads/video', {
        body: formBody([
          { key: 'folder', value: 'postman-videos' },
          { key: 'video', type: 'file', description: 'Required video file.' }
        ])
      }),
      item('Upload Document', 'POST', '/api/v1/uploads/document', {
        body: formBody([
          { key: 'folder', value: 'postman-documents' },
          { key: 'document', type: 'file', description: 'Required document file.' }
        ])
      })
    ]),

    folder('16 - Admin', 'Admin and sub-admin operations. Use Login - Admin first, or set `accessToken` to an admin/sub-admin token.', [
      item('Dashboard Overview', 'GET', '/api/v1/admin/dashboard/overview'),
      item('List Users', 'GET', '/api/v1/admin/users?q=frontend&status=active&page=1&limit=10'),
      item('Get User Details', 'GET', '/api/v1/admin/users/{{currentUserId}}'),
      item('Give Free Credits', 'POST', '/api/v1/admin/users/{{currentUserId}}/credits', { body: jsonBody({ amount: 10 }) }),
      item('Suspend User', 'POST', '/api/v1/admin/users/{{currentUserId}}/suspend', { body: jsonBody({ reason: 'Policy review.' }) }),
      item('Unsuspend User', 'POST', '/api/v1/admin/users/{{currentUserId}}/unsuspend'),
      item('Reset User Password', 'POST', '/api/v1/admin/users/{{currentUserId}}/reset-password', { body: jsonBody({ newPassword: '{{password}}' }) }),
      item('Delete User', 'DELETE', '/api/v1/admin/users/{{currentUserId}}'),
      item('List Advisor Applications', 'GET', '/api/v1/admin/advisor-applications?status=new&page=1&limit=10'),
      item('Get Advisor Application', 'GET', '/api/v1/admin/advisor-applications/{{advisorApplicationId}}'),
      item('Schedule Live Interview', 'POST', '/api/v1/admin/advisor-applications/{{advisorApplicationId}}/schedule-interview', {
        body: jsonBody({ datetime: '2026-05-12T16:00:00.000Z' })
      }),
      item('Interview Token', 'POST', '/api/v1/admin/advisor-applications/{{advisorApplicationId}}/interview-token'),
      item('Send Contract', 'POST', '/api/v1/admin/advisor-applications/{{advisorApplicationId}}/contract', {
        body: jsonBody({ contractUrl: 'https://example.com/contracts/advisor-contract.pdf' })
      }),
      item('Approve Application', 'POST', '/api/v1/admin/advisor-applications/{{advisorApplicationId}}/approve'),
      item('Reject Application', 'POST', '/api/v1/admin/advisor-applications/{{advisorApplicationId}}/reject', {
        body: jsonBody({ reason: 'Incomplete application.' })
      }),
      item('List Advisors', 'GET', '/api/v1/admin/advisors?q=frontend&status=active&page=1&limit=10'),
      item('Get Advisor', 'GET', '/api/v1/admin/advisors/{{advisorId}}'),
      item('Suspend Advisor', 'POST', '/api/v1/admin/advisors/{{advisorId}}/suspend', { body: jsonBody({ reason: 'Policy review.' }) }),
      item('Unsuspend Advisor', 'POST', '/api/v1/admin/advisors/{{advisorId}}/unsuspend'),
      item('Set Advisor Featured On Home', 'PATCH', '/api/v1/admin/advisors/{{advisorId}}/featured', {
        body: jsonBody({ isFeaturedOnHome: true })
      }),
      item('Add Advisor Manually', 'POST', '/api/v1/admin/advisors', {
        body: jsonBody({
          name: 'Manual Advisor',
          email: 'manual.advisor@example.com',
          phoneNumber: '+15550100003',
          password: '{{password}}',
          location: 'Dallas, USA',
          language: 'English',
          experience: '4',
          type: 'Tarot',
          style: 'Compassionate',
          bio: 'Manually added advisor.'
        })
      }),
      item('List Sessions', 'GET', '/api/v1/admin/sessions?tab=live&page=1&limit=10'),
      item('Get Admin Session Details', 'GET', '/api/v1/admin/sessions/{{sessionId}}'),
      item('Admin Cancel Session', 'POST', '/api/v1/admin/sessions/{{sessionId}}/cancel', {
        body: jsonBody({ reason: 'Admin cancelled session.', refundUser: true })
      }),
      item('Admin Flag Session', 'POST', '/api/v1/admin/sessions/{{sessionId}}/flag'),
      item('Admin Resolve Disputed Session', 'POST', '/api/v1/admin/sessions/{{sessionId}}/resolve'),
      item('Admin List Complaints', 'GET', '/api/v1/admin/complaints?status=pending&kind=complain&page=1&limit=10'),
      item('Admin Update Complaint Status', 'PATCH', '/api/v1/admin/complaints/{{complaintId}}', {
        body: jsonBody({ status: 'reviewing', note: 'Under admin review.' })
      }),
      item('Admin List Disputes', 'GET', '/api/v1/admin/disputes?status=open&page=1&limit=10'),
      item('Admin Mark Dispute Investigating', 'POST', '/api/v1/admin/disputes/{{disputeId}}/investigating'),
      item('Admin Resolve Dispute', 'POST', '/api/v1/admin/disputes/{{disputeId}}/resolve', {
        body: jsonBody({
          resolution: 'partial_refund',
          refundAmount: 5,
          note: 'Partial refund approved.',
          reassignAdvisorId: '{{advisorId}}',
          freeRescheduleAt: '2026-05-13T14:00:00.000Z'
        })
      }),
      item('Admin Reject Dispute', 'POST', '/api/v1/admin/disputes/{{disputeId}}/reject', {
        body: jsonBody({ note: 'Dispute rejected after review.' })
      }),
      item('Finance Overview', 'GET', '/api/v1/admin/finance/overview'),
      item('Finance Transactions', 'GET', '/api/v1/admin/finance/transactions?type=wallet_topup&status=completed&page=1&limit=10'),
      item('Finance Payouts', 'GET', '/api/v1/admin/finance/payouts?status=requested&page=1&limit=10'),
      item('Approve Payout', 'POST', '/api/v1/admin/finance/payouts/{{payoutId}}/approve'),
      item('Reject Payout', 'POST', '/api/v1/admin/finance/payouts/{{payoutId}}/reject', { body: jsonBody({ reason: 'Bank details missing.' }) }),
      item('Get Commissions', 'GET', '/api/v1/admin/finance/commissions'),
      item('Update Commissions', 'PUT', '/api/v1/admin/finance/commissions', { body: jsonBody({ bronze: 20, silver: 15, gold: 10 }) }),
      item('Update Minimum Withdrawal', 'PUT', '/api/v1/admin/finance/min-withdrawal', { body: jsonBody({ min: 50 }) }),
      item('Admin List Plans', 'GET', '/api/v1/admin/subscriptions/plans'),
      item('Admin Create Plan', 'POST', '/api/v1/admin/subscriptions/plans', {
        body: jsonBody({
          tier: 'priority',
          name: 'Premium',
          description: 'Premium monthly plan.',
          audienceLimit: 'Unlimited',
          pricePerMonth: 29,
          benefits: ['Priority advisors', 'Monthly credits'],
          sortOrder: 3,
          isActive: true
        })
      }),
      item('Admin Update Plan', 'PATCH', '/api/v1/admin/subscriptions/plans/{{planId}}', {
        body: jsonBody({ description: 'Updated plan description.', pricePerMonth: 29, isActive: true })
      }),
      item('Admin Delete Plan', 'DELETE', '/api/v1/admin/subscriptions/plans/{{planId}}'),
      item('Subscription Stats', 'GET', '/api/v1/admin/subscriptions/stats'),
      item('Sub-admin Permissions Catalog', 'GET', '/api/v1/admin/sub-admins/permissions'),
      item('List Sub-admins', 'GET', '/api/v1/admin/sub-admins?q=manager&page=1&limit=10'),
      item('Create Sub-admin', 'POST', '/api/v1/admin/sub-admins', {
        body: jsonBody({
          name: 'Support Manager',
          email: 'support.manager@example.com',
          phoneNumber: '+15550100004',
          password: '{{password}}',
          role: 'Support',
          permissions: ['users.manage', 'chats.manage', 'compliance.manage']
        })
      }),
      item('Update Sub-admin', 'PATCH', '/api/v1/admin/sub-admins/{{subAdminId}}', {
        body: jsonBody({
          name: 'Updated Support Manager',
          phoneNumber: '+15550100005',
          password: '{{password}}',
          permissions: ['users.manage', 'chats.manage']
        })
      }),
      item('Suspend Sub-admin', 'POST', '/api/v1/admin/sub-admins/{{subAdminId}}/suspend'),
      item('Unsuspend Sub-admin', 'POST', '/api/v1/admin/sub-admins/{{subAdminId}}/unsuspend'),
      item('Delete Sub-admin', 'DELETE', '/api/v1/admin/sub-admins/{{subAdminId}}'),
      item('Create Showcase Review', 'POST', '/api/v1/admin/reviews/showcase', {
        body: formBody([
          { key: 'rating', value: '5' },
          { key: 'name', value: 'Happy Client' },
          { key: 'location', value: 'California' },
          { key: 'comment', value: 'A helpful session.' },
          { key: 'photo', type: 'file', description: 'Optional showcase photo.' }
        ])
      }),
      item('Update Showcase Review', 'PATCH', '/api/v1/admin/reviews/showcase/{{reviewId}}', {
        body: formBody([
          { key: 'rating', value: '5' },
          { key: 'showcaseName', value: 'Updated Client' },
          { key: 'showcaseLocation', value: 'Texas' },
          { key: 'comment', value: 'Updated comment.' },
          { key: 'photo', type: 'file', description: 'Optional showcase photo.' }
        ])
      }),
      item('Delete Showcase Review', 'DELETE', '/api/v1/admin/reviews/showcase/{{reviewId}}'),
      item('Review Curation List', 'GET', '/api/v1/admin/reviews/curation?minRating=4&limit=100'),
      item('Set Review Featured Testimonial', 'PATCH', '/api/v1/admin/reviews/{{reviewId}}/featured', {
        body: jsonBody({ isFeaturedTestimonial: true })
      })
    ])
  ]
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(collection, null, 2)}\n`);
console.log(`Generated ${outputPath}`);
