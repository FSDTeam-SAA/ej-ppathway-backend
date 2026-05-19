import User from '../models/user.model.js';
import Plan from '../models/plan.model.js';
import CmsPage from '../models/cmsPage.model.js';
import { getPlatformSettings } from '../models/platformSetting.model.js';
import seedSiteContent from './seed-site-content.js';

export const ensureSeed = async () => {
  // Super admin
  const email = (process.env.SUPER_ADMIN_EMAIL || 'admin@propheticpathway.com').toLowerCase();
  const exists = await User.findOne({ email });
  if (!exists) {
    await User.create({
      name: process.env.SUPER_ADMIN_NAME || 'Super Admin',
      email,
      phone: process.env.SUPER_ADMIN_PHONE || '+10000000000',
      password: process.env.SUPER_ADMIN_PASSWORD || 'ChangeMe@123',
      role: 'admin',
      status: 'active',
      isVerified: true
    });
    console.log(`✓ Seeded super admin: ${email}`);
  }

  // Remove any legacy plans from the old SaaS-employee seed.
  await Plan.deleteMany({ name: { $in: ['Free', 'Basic', 'Premium'] } });

  // Default plans — three tiers shown on the "Choose Your Path Forward" screen.
  const planSeeds = [
    {
      tier: 'instant',
      name: 'Instant Access',
      tagline: 'No monthly commitment',
      pricePerMonth: 0,
      audienceLimit: 'Best for first-time or occasional users',
      ctaLabel: 'Start Instantly',
      benefits: [
        'Text: $3 / session (15-min active window)',
        'Voice: $4 / min',
        'Video: $7/min',
        'Talk to any available guide instantly',
        'No subscription required',
        'Pay only for what you use'
      ],
      perUsePricing: {
        textPerSession: 3,
        textSessionMinutes: 15,
        voicePerMinute: 4,
        videoPerMinute: 7
      },
      sortOrder: 0
    },
    {
      tier: 'clarity',
      name: 'Clarity Access',
      tagline: 'No long-term commitment',
      pricePerMonth: 59,
      audienceLimit: 'Best for: Regular guidance. Includes monthly usage. Continue anytime at discounted member rates.',
      ctaLabel: 'Choose Clarity',
      benefits: [
        '60 text messages',
        '40 voice minutes',
        '15 video minutes',
        '15–20% lower rates on extra usage',
        'Priority matching',
        '1 free session recording/month'
      ],
      included: {
        textMessages: 60,
        voiceMinutes: 40,
        videoMinutes: 15,
        recordingsPerMonth: 1
      },
      overageDiscountPercent: 20,
      priorityMatching: true,
      sortOrder: 1
    },
    {
      tier: 'priority',
      name: 'Priority Access',
      tagline: 'Premium, faster access',
      pricePerMonth: 119,
      audienceLimit: 'Best for: High-frequency users',
      ctaLabel: 'Upgrade plan',
      benefits: [
        '150 text messages',
        '90 voice minutes',
        '40 video minutes',
        '25% lower rates on extra usage',
        'Skip the wait (priority queue)',
        'Top-rated guides access',
        '3 recordings / month'
      ],
      included: {
        textMessages: 150,
        voiceMinutes: 90,
        videoMinutes: 40,
        recordingsPerMonth: 3
      },
      overageDiscountPercent: 25,
      priorityMatching: true,
      skipWait: true,
      topRatedGuidesAccess: true,
      sortOrder: 2
    }
  ];
  for (const p of planSeeds) {
    await Plan.findOneAndUpdate({ tier: p.tier }, { $set: p }, { upsert: true, new: true });
  }

  // CMS placeholders
  const pages = [
    { slug: 'privacy_policy', title: 'Privacy Policy' },
    { slug: 'terms_of_service', title: 'Terms of Service' },
    { slug: 'about_app', title: 'About App' }
  ];
  for (const p of pages) {
    await CmsPage.findOneAndUpdate({ slug: p.slug }, { $setOnInsert: { ...p, content: '' } }, { upsert: true });
  }

  // Platform settings
  await getPlatformSettings();

  // Marketing-site default copy (pixel-perfect Figma defaults — admin can override)
  await seedSiteContent();

  console.log('✓ Seed verified');
};

export default ensureSeed;
