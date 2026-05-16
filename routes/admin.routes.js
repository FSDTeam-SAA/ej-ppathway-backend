import { Router } from 'express';
import { auth, requirePermission } from '../middlewares/auth.js';
import { dashboardOverview } from '../controllers/admin.dashboard.controller.js';
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
  setAdvisorFeaturedOnHome
} from '../controllers/admin.advisors.controller.js';
import {
  listSessions,
  getSession,
  adminCancelSession,
  adminFlagSession,
  adminResolveDisputed
} from '../controllers/admin.sessions.controller.js';
import {
  overview as financeOverview,
  listTransactions,
  listPayouts,
  approvePayout,
  rejectPayout,
  updateCommissions,
  getCommissions,
  updateMinWithdrawal
} from '../controllers/admin.finance.controller.js';
import {
  createPlan,
  updatePlan,
  deletePlan,
  listPlans as adminListPlans,
  subscriptionStats
} from '../controllers/admin.subscriptions.controller.js';
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
  adminListDisputes,
  adminResolveDispute,
  adminRejectDispute,
  adminMarkInvestigating
} from '../controllers/dispute.controller.js';
import {
  adminListComplaints,
  adminUpdateComplaintStatus
} from '../controllers/complaint.controller.js';
import {
  adminCreateShowcaseReview,
  adminUpdateShowcaseReview,
  adminDeleteShowcaseReview,
  adminSetReviewFeatured,
  adminListReviewsForCuration
} from '../controllers/review.controller.js';
import { imageUpload } from '../middlewares/upload.js';

const router = Router();

router.use(auth('admin', 'sub_admin'));

// Dashboard
router.get('/dashboard/overview', dashboardOverview);

// Users
router.get('/users', requirePermission('users.manage'), listUsers);
router.get('/users/:id', requirePermission('users.manage'), getUserDetails);
router.post('/users/:id/credits', requirePermission('users.manage'), giveFreeCredits);
router.post('/users/:id/suspend', requirePermission('users.manage'), suspendUser);
router.post('/users/:id/unsuspend', requirePermission('users.manage'), unsuspendUser);
router.post('/users/:id/reset-password', requirePermission('users.manage'), adminResetUserPassword);
router.delete('/users/:id', requirePermission('users.manage'), deleteUser);

// Advisor approvals
router.get('/advisor-applications', requirePermission('advisors.approve'), listApplications);
router.get('/advisor-applications/:id', requirePermission('advisors.approve'), getApplication);
router.post('/advisor-applications/:id/schedule-interview', requirePermission('advisors.approve'), scheduleLiveInterview);
router.post('/advisor-applications/:id/interview-token', requirePermission('advisors.approve'), interviewToken);
router.post('/advisor-applications/:id/contract', requirePermission('advisors.approve'), sendContract);
router.post('/advisor-applications/:id/approve', requirePermission('advisors.approve'), approveApplication);
router.post('/advisor-applications/:id/reject', requirePermission('advisors.approve'), rejectApplication);

// Advisors
router.get('/advisors', requirePermission('advisors.manage'), listAdvisors);
router.get('/advisors/:id', requirePermission('advisors.manage'), getAdvisor);
router.post('/advisors/:id/suspend', requirePermission('advisors.manage'), suspendAdvisor);
router.post('/advisors/:id/unsuspend', requirePermission('advisors.manage'), unsuspendAdvisor);
router.post('/advisors', requirePermission('advisors.manage'), addAdvisorManually);
router.patch('/advisors/:id/featured', requirePermission('advisors.manage'), setAdvisorFeaturedOnHome);

// Sessions
router.get('/sessions', requirePermission('sessions.manage'), listSessions);
router.get('/sessions/:id', requirePermission('sessions.manage'), getSession);
router.post('/sessions/:id/cancel', requirePermission('sessions.manage'), adminCancelSession);
router.post('/sessions/:id/flag', requirePermission('sessions.manage'), adminFlagSession);
router.post('/sessions/:id/resolve', requirePermission('sessions.manage'), adminResolveDisputed);

// Compliance
router.get('/complaints', requirePermission('compliance.manage'), adminListComplaints);
router.patch('/complaints/:id', requirePermission('compliance.manage'), adminUpdateComplaintStatus);

// Disputes
router.get('/disputes', requirePermission('compliance.manage'), adminListDisputes);
router.post('/disputes/:id/investigating', requirePermission('compliance.manage'), adminMarkInvestigating);
router.post('/disputes/:id/resolve', requirePermission('compliance.manage'), adminResolveDispute);
router.post('/disputes/:id/reject', requirePermission('compliance.manage'), adminRejectDispute);

// Finance
router.get('/finance/overview', requirePermission('finance.manage'), financeOverview);
router.get('/finance/transactions', requirePermission('finance.manage'), listTransactions);
router.get('/finance/payouts', requirePermission('finance.manage'), listPayouts);
router.post('/finance/payouts/:id/approve', requirePermission('finance.manage'), approvePayout);
router.post('/finance/payouts/:id/reject', requirePermission('finance.manage'), rejectPayout);
router.get('/finance/commissions', requirePermission('finance.manage'), getCommissions);
router.put('/finance/commissions', requirePermission('finance.manage'), updateCommissions);
router.put('/finance/min-withdrawal', requirePermission('finance.manage'), updateMinWithdrawal);

// Subscriptions
router.get('/subscriptions/plans', requirePermission('subscriptions.manage'), adminListPlans);
router.post('/subscriptions/plans', requirePermission('subscriptions.manage'), createPlan);
router.patch('/subscriptions/plans/:id', requirePermission('subscriptions.manage'), updatePlan);
router.delete('/subscriptions/plans/:id', requirePermission('subscriptions.manage'), deletePlan);
router.get('/subscriptions/stats', requirePermission('subscriptions.manage'), subscriptionStats);

// Sub-admins
router.get('/sub-admins/permissions', requirePermission('sub_admins.manage'), getPermissionsList);
router.get('/sub-admins', requirePermission('sub_admins.manage'), listSubAdmins);
router.post('/sub-admins', requirePermission('sub_admins.manage'), createSubAdmin);
router.patch('/sub-admins/:id', requirePermission('sub_admins.manage'), updateSubAdmin);
router.post('/sub-admins/:id/suspend', requirePermission('sub_admins.manage'), suspendSubAdmin);
router.post('/sub-admins/:id/unsuspend', requirePermission('sub_admins.manage'), unsuspendSubAdmin);
router.delete('/sub-admins/:id', requirePermission('sub_admins.manage'), deleteSubAdmin);

// Showcase reviews
router.post('/reviews/showcase', requirePermission('reviews.manage'), imageUpload.single('photo'), adminCreateShowcaseReview);
router.patch('/reviews/showcase/:id', requirePermission('reviews.manage'), imageUpload.single('photo'), adminUpdateShowcaseReview);
router.delete('/reviews/showcase/:id', requirePermission('reviews.manage'), adminDeleteShowcaseReview);

// Review curation for homepage testimonials
router.get('/reviews/curation', requirePermission('reviews.manage'), adminListReviewsForCuration);
router.patch('/reviews/:id/featured', requirePermission('reviews.manage'), adminSetReviewFeatured);

export default router;
