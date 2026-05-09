import User from '../models/user.model.js';
import Plan from '../models/plan.model.js';
import CmsPage from '../models/cmsPage.model.js';
import { getPlatformSettings } from '../models/platformSetting.model.js';

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

  // Default plans
  const planSeeds = [
    { name: 'Free', pricePerMonth: 0, audienceLimit: 'Up to 10 employees', sortOrder: 0,
      benefits: ['Limited reporting', 'Basic attendance tracking', 'Email support', '7-day data retention'] },
    { name: 'Basic', pricePerMonth: 347, audienceLimit: 'Up to 50 employees', sortOrder: 1,
      benefits: ['All Basic features', '90-day data retention', 'Role-based access control', 'Personalized intervention strategies', 'Advanced analytics & reports'] },
    { name: 'Premium', pricePerMonth: 197, audienceLimit: 'Unlimited employees', sortOrder: 2,
      benefits: ['All Premium features', 'Custom reporting', 'Unlimited data retention', 'Advanced security features', 'Unlimited Task management'] }
  ];
  for (const p of planSeeds) {
    await Plan.findOneAndUpdate({ name: p.name }, { $setOnInsert: p }, { upsert: true });
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

  console.log('✓ Seed verified');
};

export default ensureSeed;
