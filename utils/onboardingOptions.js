// Canonical option lists for the onboarding questionnaire shown to users
// right after OTP verification ("Help us personalize your experience").
// These are returned to the frontend so the UI stays in sync with the backend
// and used to validate the values posted to /users/preferences.

export const SEEKING_HELP_WITH = [
  'Seeking clarity',
  'Relationship guidance',
  'Spiritual growth',
  'Career direction',
  'Healing & peace',
  'Prayer support',
  'Dream interpretation',
  'Life purpose',
  'Emotional encouragement',
  'Interpretation Of Tongues',
  'Interpretation Of Visions'
];

export const GUIDANCE_TYPES = [
  'Prophetic insight',
  'Prayer & encouragement',
  'Dream interpretation',
  'Spiritual mentoring',
  'Biblical wisdom',
  'Deep conversation',
  'Energy & emotional healing',
  'General life guidance'
];

export const CONNECTION_METHODS = ['Text', 'Voice Call', 'Video Call'];

export const ATMOSPHERES = [
  'Calm & peaceful',
  'Direct & honest',
  'Warm & encouraging',
  'Deep & spiritual',
  'Friendly conversation',
  'Professional guidance'
];

export const GUIDANCE_FREQUENCIES = [
  'Just exploring',
  'Occasionally',
  'Weekly',
  'Frequently',
  'During difficult moments'
];

export const TAILORED_AREAS = [
  'Relationships',
  'Family',
  'Marriage',
  'Finances',
  'Career',
  'Purpose',
  'Anxiety',
  'Grief',
  'Spiritual warfare',
  'Faith growth',
  'Decision making'
];

export const GUIDE_QUALITY_PRIORITIES = [
  'Accuracy',
  'Fast responses',
  'Experience',
  'Spiritual depth',
  'Confidentiality',
  'Testimonials/reviews'
];

export const ONBOARDING_STEPS = [
  { key: 'seekingHelpWith', step: 1, title: 'What brings you here today?', type: 'multi', options: SEEKING_HELP_WITH },
  { key: 'guidanceType', step: 2, title: 'What type of guidance do you connect with most?', type: 'single', options: GUIDANCE_TYPES },
  { key: 'connectionMethods', step: 3, title: 'How would you like to connect?', type: 'multi', options: CONNECTION_METHODS },
  { key: 'atmosphere', step: 4, title: 'What kind of atmosphere helps you feel comfortable?', type: 'single', options: ATMOSPHERES },
  { key: 'guidanceFrequency', step: 5, title: 'How often do you think you’ll seek guidance?', type: 'single', options: GUIDANCE_FREQUENCIES },
  { key: 'tailoredAreas', step: 6, title: 'Would you like guidance tailored to specific areas?', type: 'multi', options: TAILORED_AREAS },
  { key: 'guideQualityPriority', step: 7, title: 'What matters most when choosing a guide?', type: 'single', options: GUIDE_QUALITY_PRIORITIES },
  { key: 'usedPlatformBefore', step: 8, title: 'Have you ever used a spiritual guidance platform before?', type: 'boolean', options: ['No', 'Yes'] }
];

export const ONBOARDING_TOTAL_STEPS = ONBOARDING_STEPS.length;
