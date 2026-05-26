import { Router } from 'express';
import { auth, requirePermission } from '../middlewares/auth.js';

// Controllers
import { dashboardOverview } from '../controllers/admin.dashboard.controller.js';
import { onboardingAnalytics } from '../controllers/admin.onboarding.controller.js';

import {
  listUsers,
  getUserDetails,
  giveFreeCredits,
  suspendUser,
  unsuspendUser,
  adminResetUserPassword,
  deleteUser
} from '../controllers/admin.users.controller.js';

import {
  listApplications,
  getApplication,
  scheduleLiveInterview,
  interviewToken,
  sendContract,
  approveApplication,
  rejectApplication,
  listAdvisors,
  getAdvisor,
  suspendAdvisor,
  unsuspendAdvisor,
  addAdvisorManually,
  deleteApplication,
  deleteAdvisor,
  setAdvisorFeaturedOnHome
} from '../controllers/admin.advisors.controller.js';

import {
  listSessions,
  getSession,
  adminCancelSession,
  adminFlagSession,
  adminResolveDisputed,
  adminDeleteSession
} from '../controllers/admin.sessions.controller.js';

import {
  overview,
  listTransactions,
  listPayouts,
  approvePayout,
  rejectPayout,
  deleteTransaction,
  updateCommissions,
  getCommissions,
  updateMinWithdrawal
} from '../controllers/admin.finance.controller.js';

import {
  listSubAdmins,
  getPermissionsList,
  createSubAdmin,
  updateSubAdmin,
  suspendSubAdmin,
  unsuspendSubAdmin,
  deleteSubAdmin
} from '../controllers/admin.subadmins.controller.js';

import {
  createPlan,
  updatePlan,
  deletePlan,
  listPlans,
  subscriptionStats
} from '../controllers/admin.subscriptions.controller.js';

const router = Router();

router.use(auth('admin', 'sub_admin'));

// Dashboard
router.get('/dashboard', requirePermission(), dashboardOverview);
router.get('/onboarding-analytics', onboardingAnalytics);

// Users
router.get('/users', requirePermission('users.manage'), listUsers);
router.get('/users/:id', requirePermission('users.manage'), getUserDetails);
router.post('/users/:id/free-credits', requirePermission('users.manage'), giveFreeCredits);
router.patch('/users/:id/suspend', requirePermission('users.manage'), suspendUser);
router.patch('/users/:id/unsuspend', requirePermission('users.manage'), unsuspendUser);
router.patch('/users/:id/reset-password', requirePermission('users.manage'), adminResetUserPassword);
router.delete('/users/:id', requirePermission('users.manage'), deleteUser);

// Advisor applications
router.get('/applications', requirePermission('advisors.approve'), listApplications);
router.get('/applications/:id', requirePermission('advisors.approve'), getApplication);
router.post('/applications/:id/schedule-interview', requirePermission('advisors.approve'), scheduleLiveInterview);
router.get('/applications/:id/interview-token', interviewToken);
router.post('/applications/:id/send-contract', requirePermission('advisors.approve'), sendContract);
router.post('/applications/:id/approve', requirePermission('advisors.approve'), approveApplication);
router.post('/applications/:id/reject', requirePermission('advisors.approve'), rejectApplication);
router.delete('/applications/:id', requirePermission('advisors.approve'), deleteApplication);

// Advisors
router.get('/advisors', requirePermission('advisors.manage'), listAdvisors);
router.get('/advisors/:id', requirePermission('advisors.manage'), getAdvisor);
router.post('/advisors', requirePermission('advisors.manage'), addAdvisorManually);
router.patch('/advisors/:id/suspend', requirePermission('advisors.manage'), suspendAdvisor);
router.patch('/advisors/:id/unsuspend', requirePermission('advisors.manage'), unsuspendAdvisor);
router.patch('/advisors/:id/featured', requirePermission('advisors.manage'), setAdvisorFeaturedOnHome);
router.delete('/advisors/:id', requirePermission('advisors.manage'), deleteAdvisor);

// Sessions
router.get('/sessions', requirePermission('sessions.manage'), listSessions);
router.get('/sessions/:id', requirePermission('sessions.manage'), getSession);
router.post('/sessions/:id/cancel', requirePermission('sessions.manage'), adminCancelSession);
router.patch('/sessions/:id/flag', requirePermission('sessions.manage'), adminFlagSession);
router.patch('/sessions/:id/resolve', requirePermission('sessions.manage'), adminResolveDisputed);
router.delete('/sessions/:id', requirePermission('sessions.manage'), adminDeleteSession);

// Finance
router.get('/finance/overview', requirePermission('finance.manage'), overview);
router.get('/finance/transactions', requirePermission('finance.manage'), listTransactions);
router.delete('/finance/transactions/:id', requirePermission('finance.manage'), deleteTransaction);
router.get('/finance/payouts', requirePermission('finance.manage'), listPayouts);
router.post('/finance/payouts/:id/approve', requirePermission('finance.manage'), approvePayout);
router.post('/finance/payouts/:id/reject', requirePermission('finance.manage'), rejectPayout);
router.get('/finance/commissions', requirePermission('finance.manage'), getCommissions);
router.patch('/finance/commissions', requirePermission('finance.manage'), updateCommissions);
router.patch('/finance/min-withdrawal', requirePermission('finance.manage'), updateMinWithdrawal);

// Subscription plans
router.get('/plans', requirePermission('subscriptions.manage'), listPlans);
router.post('/plans', requirePermission('subscriptions.manage'), createPlan);
router.patch('/plans/:id', requirePermission('subscriptions.manage'), updatePlan);
router.delete('/plans/:id', requirePermission('subscriptions.manage'), deletePlan);
router.get('/subscriptions/stats', requirePermission('subscriptions.manage'), subscriptionStats);

// Sub-admins
router.get('/sub-admins', requirePermission('sub_admins.manage'), listSubAdmins);
router.get('/sub-admins/permissions-list', getPermissionsList);
router.post('/sub-admins', requirePermission('sub_admins.manage'), createSubAdmin);
router.patch('/sub-admins/:id', requirePermission('sub_admins.manage'), updateSubAdmin);
router.patch('/sub-admins/:id/suspend', requirePermission('sub_admins.manage'), suspendSubAdmin);
router.patch('/sub-admins/:id/unsuspend', requirePermission('sub_admins.manage'), unsuspendSubAdmin);
router.delete('/sub-admins/:id', requirePermission('sub_admins.manage'), deleteSubAdmin);

export default router;
