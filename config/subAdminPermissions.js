// Granular sub-admin permission catalog + named role presets.
// Permissions are grouped by the admin section they govern; role presets bundle
// a sensible default set so admins can pick a role instead of ticking 40 boxes.

export const PERMISSION_GROUPS = [
  {
    section: 'Dashboard Overview',
    permissions: [{ key: 'dashboard.view', label: 'View Dashboard' }]
  },
  {
    section: 'Users Management',
    permissions: [
      { key: 'users.view', label: 'View Users' },
      { key: 'users.edit', label: 'Edit Users' },
      { key: 'users.suspend', label: 'Suspend Users' },
      { key: 'users.delete', label: 'Delete Users' }
    ]
  },
  {
    section: 'Onboarding Analytics',
    permissions: [{ key: 'analytics.view', label: 'View Analytics' }]
  },
  {
    section: 'Advisor Approvals',
    permissions: [
      { key: 'approvals.view', label: 'View Applications' },
      { key: 'approvals.interview', label: 'Interview Advisors' },
      { key: 'approvals.approve', label: 'Approve Advisors' },
      { key: 'approvals.decline', label: 'Decline Advisors' },
      { key: 'approvals.contract', label: 'Send Contracts' }
    ]
  },
  {
    section: 'Advisor Management',
    permissions: [
      { key: 'advisors.view', label: 'View Advisors' },
      { key: 'advisors.edit', label: 'Edit Advisor Profiles' },
      { key: 'advisors.suspend', label: 'Suspend Advisors' },
      { key: 'advisors.reactivate', label: 'Reactivate Advisors' },
      { key: 'advisors.reset_password', label: 'Reset Advisor Passwords' }
    ]
  },
  {
    section: 'Session Management',
    permissions: [
      { key: 'sessions.view', label: 'View Sessions' },
      { key: 'sessions.cancel', label: 'Cancel Sessions' },
      { key: 'sessions.modify', label: 'Modify Sessions' }
    ]
  },
  {
    section: 'Session Recordings',
    permissions: [
      { key: 'recordings.view', label: 'View Recordings' },
      { key: 'recordings.download', label: 'Download Recordings' },
      { key: 'recordings.transcripts', label: 'View Chat Transcripts' },
      { key: 'recordings.delete', label: 'Delete Recordings' }
    ]
  },
  {
    section: 'Compliance & Safety',
    permissions: [
      { key: 'compliance.view', label: 'View Compliance Cases' },
      { key: 'compliance.investigate', label: 'Investigate Complaints' },
      { key: 'compliance.warn', label: 'Issue Warnings' },
      { key: 'compliance.suspend_accounts', label: 'Suspend Accounts' }
    ]
  },
  {
    section: 'Revenue & Finance',
    permissions: [
      { key: 'finance.view', label: 'View Revenue Dashboard' },
      { key: 'finance.transactions', label: 'View Transactions' },
      { key: 'finance.refunds', label: 'Manage Refunds' },
      { key: 'finance.chargebacks', label: 'Manage Chargebacks' },
      { key: 'finance.approve_payouts', label: 'Approve Payouts' },
      { key: 'finance.release_payouts', label: 'Release Payouts' }
    ]
  },
  {
    section: 'Subscription Plans',
    permissions: [
      { key: 'plans.view', label: 'View Plans' },
      { key: 'plans.create', label: 'Create Plans' },
      { key: 'plans.edit', label: 'Edit Plans' },
      { key: 'plans.delete', label: 'Delete Plans' }
    ]
  },
  {
    section: 'Content (CMS)',
    permissions: [
      { key: 'cms.pages', label: 'Manage Pages' },
      { key: 'cms.faqs', label: 'Manage FAQs' },
      { key: 'cms.blogs', label: 'Manage Blogs' },
      { key: 'cms.legal', label: 'Manage Legal Documents' }
    ]
  },
  {
    section: 'Support Chat',
    permissions: [
      { key: 'chat.view', label: 'View Conversations' },
      { key: 'chat.reply', label: 'Reply To Users' },
      { key: 'chat.escalate', label: 'Escalate Tickets' }
    ]
  },
  {
    section: 'Sub Admins',
    permissions: [
      { key: 'subadmins.view', label: 'View Sub Admins' },
      { key: 'subadmins.add', label: 'Add Sub Admins' },
      { key: 'subadmins.edit_permissions', label: 'Edit Permissions' },
      { key: 'subadmins.remove', label: 'Remove Sub Admins' }
    ]
  },
  {
    section: 'Review Management',
    permissions: [
      { key: 'reviews.view', label: 'View Reviews' },
      { key: 'reviews.remove', label: 'Remove Reviews' },
      { key: 'reviews.feature', label: 'Feature Reviews' }
    ]
  },
  {
    section: 'Testimonials',
    permissions: [
      { key: 'testimonials.view', label: 'View Testimonials' },
      { key: 'testimonials.approve', label: 'Approve Testimonials' },
      { key: 'testimonials.remove', label: 'Remove Testimonials' }
    ]
  }
];

// Flat list of every valid permission key.
export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

const keysFor = (...sections) =>
  PERMISSION_GROUPS.filter((g) => sections.includes(g.section)).flatMap((g) => g.permissions.map((p) => p.key));

// Named roles. `*` means "all permissions" (Super Admin). Custom = pick-your-own.
export const ROLE_PRESETS = {
  super_admin: { label: 'Super Admin', description: 'Automatically has full platform access', permissions: ['*'] },
  advisor_manager: {
    label: 'Advisor Manager',
    description: 'Advisor recruitment and management',
    permissions: keysFor('Dashboard Overview', 'Advisor Approvals', 'Advisor Management', 'Session Recordings')
  },
  operations_manager: {
    label: 'Operations Manager',
    description: 'Sessions, onboarding, and daily operations',
    permissions: keysFor('Dashboard Overview', 'Onboarding Analytics', 'Session Management', 'Session Recordings', 'Advisor Management')
  },
  finance_manager: {
    label: 'Finance Manager',
    description: 'Revenue, payouts, subscriptions, refunds, commissions',
    permissions: keysFor('Dashboard Overview', 'Revenue & Finance', 'Subscription Plans')
  },
  compliance_manager: {
    label: 'Compliance Manager',
    description: 'Session reviews, disputes, recordings, complaints, investigations',
    permissions: keysFor('Dashboard Overview', 'Compliance & Safety', 'Session Management', 'Session Recordings')
  },
  support_manager: {
    label: 'Customer Support Manager',
    description: 'User support and issue resolution',
    permissions: keysFor('Dashboard Overview', 'Support Chat', 'Users Management')
  },
  content_manager: {
    label: 'Content Manager',
    description: 'CMS, reviews, and testimonials',
    permissions: keysFor('Dashboard Overview', 'Content (CMS)', 'Review Management', 'Testimonials')
  },
  custom: { label: 'Custom Role', description: 'Permission-based access', permissions: [] }
};

// Resolve the effective permission set for a (role, explicitPermissions) pair.
export const resolvePermissions = (roleKey, explicit = []) => {
  if (roleKey === 'super_admin') return ['*'];
  const preset = ROLE_PRESETS[roleKey];
  if (preset && roleKey !== 'custom') return preset.permissions;
  // custom / unknown → validate the supplied list against the catalog
  return (explicit || []).filter((p) => ALL_PERMISSIONS.includes(p));
};

export default { PERMISSION_GROUPS, ALL_PERMISSIONS, ROLE_PRESETS, resolvePermissions };
