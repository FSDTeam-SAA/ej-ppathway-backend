import AdminActivity from '../models/adminActivity.model.js';
import User from '../models/user.model.js';

// Best-effort audit logging — never let a logging failure break the action that
// actually happened. Also bumps the acting admin's lastActiveAt.
export const logAdminActivity = async ({ adminId, action, description = '', targetType = 'other', targetUser = null, meta }) => {
  if (!adminId) return;
  try {
    await AdminActivity.create({ admin: adminId, action, description, targetType, targetUser, meta });
    await User.updateOne({ _id: adminId }, { lastActiveAt: new Date() });
  } catch (err) {
    console.error('[activity] log failed:', err?.message || err);
  }
};

export default { logAdminActivity };
