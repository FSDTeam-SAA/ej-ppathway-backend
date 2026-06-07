import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import { imageUpload } from '../middlewares/upload.js';

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
  deleteApplication,
  listAdvisors,
  getAdvisor,
  addAdvisorManually,
  suspendAdvisor,
  unsuspendAdvisor,
  deleteAdvisor,
  setAdvisorFeaturedOnHome
} from '../controllers/admin.advisors.controller.js';

import {
  listSessions,
  listRecordings,
  getSession,
  adminCancelSession,
  adminFlagSession,
  adminResolveDisputed,
  adminDeleteSession
} from '../controllers/admin.sessions.controller.js';

import {
  overview,
  listTransactions,
  deleteTransaction,
  listPayouts,
  approvePayout,
  rejectPayout,
  getCommissions,
  updateCommissions,
  updateMinWithdrawal
} from '../controllers/admin.finance.controller.js';

import {
  getSignupFreeCredits,
  updateSignupFreeCredits
} from '../controllers/admin.settings.controller.js';

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
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  subscriptionStats
} from '../controllers/admin.subscriptions.controller.js';

import {
  adminListCurrencies,
  createCurrency,
  updateCurrency,
  deleteCurrency
} from '../controllers/currency.controller.js';

import { onboardingAnalytics } from '../controllers/admin.onboarding.controller.js';

import {
  adminListComplaints,
  adminDeleteComplaint,
  adminUpdateComplaintStatus
} from '../controllers/complaint.controller.js';

import {
  adminListDisputes,
  adminMarkInvestigating,
  adminResolveDispute,
  adminRejectDispute
} from '../controllers/dispute.controller.js';

import {
  adminListReviewsForCuration,
  adminSetReviewFeatured,
  listShowcaseReviews,
  adminCreateShowcaseReview,
  adminUpdateShowcaseReview,
  adminDeleteShowcaseReview,
  adminListUserReviews,
  adminUpdateUserReview,
  adminDeleteUserReview
} from '../controllers/review.controller.js';

import {
  adminListContactMessages,
  adminGetContactMessage,
  adminUpdateContactMessage,
  adminDeleteContactMessage
} from '../controllers/contact.controller.js';

const router = Router();

router.use(auth('admin', 'sub_admin'));

// Dashboard
router.get('/dashboard/overview', dashboardOverview);

// Users
router.get('/users', listUsers);
router.get('/users/:id', getUserDetails);
router.post('/users/:id/credits', giveFreeCredits);
router.patch('/users/:id/suspend', suspendUser);
router.patch('/users/:id/unsuspend', unsuspendUser);
router.patch('/users/:id/reset-password', adminResetUserPassword);
router.delete('/users/:id', deleteUser);

// Advisor applications
router.get('/advisor-applications', listApplications);
router.get('/advisor-applications/:id', getApplication);
router.patch('/advisor-applications/:id/schedule-interview', scheduleLiveInterview);
router.get('/advisor-applications/:id/interview-token', interviewToken);
router.patch('/advisor-applications/:id/contract', sendContract);
router.patch('/advisor-applications/:id/approve', approveApplication);
router.patch('/advisor-applications/:id/reject', rejectApplication);
router.delete('/advisor-applications/:id', deleteApplication);

// Advisors
router.get('/advisors', listAdvisors);
router.get('/advisors/:id', getAdvisor);
router.post('/advisors', addAdvisorManually);
router.patch('/advisors/:id/suspend', suspendAdvisor);
router.patch('/advisors/:id/unsuspend', unsuspendAdvisor);
router.patch('/advisors/:id/featured', setAdvisorFeaturedOnHome);
router.delete('/advisors/:id', deleteAdvisor);

// Sessions
router.get('/sessions', listSessions);
router.get('/sessions/recordings', listRecordings); // must precede '/sessions/:id'
router.get('/sessions/:id', getSession);
router.patch('/sessions/:id/cancel', adminCancelSession);
router.patch('/sessions/:id/flag', adminFlagSession);
router.patch('/sessions/:id/resolve', adminResolveDisputed);
router.delete('/sessions/:id', adminDeleteSession);

// Finance
router.get('/finance/overview', overview);
router.get('/finance/transactions', listTransactions);
router.delete('/finance/transactions/:id', deleteTransaction);
router.get('/finance/payouts', listPayouts);
router.patch('/finance/payouts/:id/approve', approvePayout);
router.patch('/finance/payouts/:id/reject', rejectPayout);
router.get('/finance/commissions', getCommissions);
router.patch('/finance/commissions', updateCommissions);
router.patch('/finance/min-withdrawal', updateMinWithdrawal);

// Platform settings — signup free credits
router.get('/settings/signup-credits', getSignupFreeCredits);
router.patch('/settings/signup-credits', updateSignupFreeCredits);

// Sub-admins
router.get('/sub-admins/permissions', getPermissionsList);
router.get('/sub-admins', listSubAdmins);
router.post('/sub-admins', createSubAdmin);
router.patch('/sub-admins/:id', updateSubAdmin);
router.patch('/sub-admins/:id/suspend', suspendSubAdmin);
router.patch('/sub-admins/:id/unsuspend', unsuspendSubAdmin);
router.delete('/sub-admins/:id', deleteSubAdmin);

// Subscription plans
router.get('/subscriptions/stats', subscriptionStats);
router.get('/subscriptions/plans', listPlans);
router.post('/subscriptions/plans', createPlan);
router.patch('/subscriptions/plans/:id', updatePlan);
router.delete('/subscriptions/plans/:id', deletePlan);

// Currencies / country pricing config
router.get('/currencies', adminListCurrencies);
router.post('/currencies', createCurrency);
router.patch('/currencies/:id', updateCurrency);
router.delete('/currencies/:id', deleteCurrency);

// Onboarding analytics
router.get('/onboarding-analytics', onboardingAnalytics);

// Complaints & safety reports
router.get('/complaints', adminListComplaints);
router.patch('/complaints/:id', adminUpdateComplaintStatus);
router.delete('/complaints/:id', adminDeleteComplaint);

// Disputes
router.get('/disputes', adminListDisputes);
router.patch('/disputes/:id/investigating', adminMarkInvestigating);
router.patch('/disputes/:id/resolve', adminResolveDispute);
router.patch('/disputes/:id/reject', adminRejectDispute);

// Reviews — curation & showcase
router.get('/reviews/curation', adminListReviewsForCuration);
router.patch('/reviews/:id/featured', adminSetReviewFeatured);
router.get('/reviews/showcase', listShowcaseReviews);
router.post('/reviews/showcase', imageUpload.single('photo'), adminCreateShowcaseReview);
router.patch('/reviews/showcase/:id', imageUpload.single('photo'), adminUpdateShowcaseReview);
router.delete('/reviews/showcase/:id', adminDeleteShowcaseReview);

// Reviews — real user reviews (moderation: list / edit / delete)
router.get('/reviews/user', adminListUserReviews);
router.patch('/reviews/user/:id', adminUpdateUserReview);
router.delete('/reviews/user/:id', adminDeleteUserReview);

// Contact messages
router.get('/contact', adminListContactMessages);
router.get('/contact/:id', adminGetContactMessage);
router.patch('/contact/:id', adminUpdateContactMessage);
router.delete('/contact/:id', adminDeleteContactMessage);

export default router;     