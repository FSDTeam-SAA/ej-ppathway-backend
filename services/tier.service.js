import AdvisorProfile from '../models/advisorProfile.model.js';
import { getPlatformSettings } from '../models/platformSetting.model.js';

export const computeTier = async (advisorId) => {
  const profile = await AdvisorProfile.findOne({ user: advisorId });
  if (!profile) return null;
  const settings = await getPlatformSettings();
  const sessions = profile.completedSessions || 0;
  const rating = profile.avgRating || 0;
  const retention = profile.repeatClientRate || 0;

  const t = settings.tierThresholds;
  let tier = 'silver';
  if (
    sessions >= t.platinum.sessions &&
    rating >= t.platinum.ratings &&
    retention >= t.platinum.retention
  ) tier = 'platinum';
  else if (
    sessions >= t.gold.sessions &&
    rating >= t.gold.ratings &&
    retention >= t.gold.retention
  ) tier = 'gold';

  if (profile.tier !== tier) {
    profile.tier = tier;
    await profile.save();
  }
  return tier;
};

export const commissionPercentForAdvisor = async (advisorId) => {
  const profile = await AdvisorProfile.findOne({ user: advisorId });
  const settings = await getPlatformSettings();
  if (!profile) return settings.commissions.silver;
  const tier = profile.tier === 'bronze' ? 'silver' : profile.tier;
  return settings.commissions[tier] ?? settings.commissions.silver;
};
