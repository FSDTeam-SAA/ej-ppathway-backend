import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import notFound from './middlewares/notFound.js';
import globalErrorHandler from './middlewares/globalErrorHandler.js';

// routes
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import publicAdvisorRoutes from './routes/publicAdvisor.routes.js';
import advisorRoutes from './routes/advisor.routes.js';
import sessionRoutes from './routes/session.routes.js';
import walletRoutes from './routes/wallet.routes.js';
import subscriptionRoutes from './routes/subscription.routes.js';
import currencyRoutes from './routes/currency.routes.js';
import locationRoutes from './routes/location.routes.js';
import disputeRoutes from './routes/dispute.routes.js';
import complaintRoutes from './routes/complaint.routes.js';
import reviewRoutes from './routes/review.routes.js';
import adminRoutes from './routes/admin.routes.js';
import cmsRoutes from './routes/cms.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import chatRoutes from './routes/chat.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import contactRoutes from './routes/contact.routes.js';
import webhookRoutes from './routes/webhook.routes.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));

// Webhooks must be mounted BEFORE express.json() so their raw body is preserved
// for signature verification (LiveKit egress recording callbacks).
app.use('/api/v1/webhooks', webhookRoutes);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// rate limiting on auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Try again later.' }
});
app.use('/api/v1/auth', authLimiter);

app.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    name: 'Prophetic Pathway API',
    version: '1.0.0',
    docs: '/api/v1/health'
  });
});

app.get('/api/v1/health', (_req, res) => {
  res.status(200).json({ success: true, message: 'OK', time: new Date().toISOString() });
});

// public + auth + role-protected route mounting
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/advisors', publicAdvisorRoutes);     // public advisor browse/details
app.use('/api/v1/advisor', advisorRoutes);            // logged-in advisor self
app.use('/api/v1/sessions', sessionRoutes);
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/subscriptions', subscriptionRoutes);
app.use('/api/v1/currencies', currencyRoutes);
app.use('/api/v1/locations', locationRoutes);
app.use('/api/v1/disputes', disputeRoutes);
app.use('/api/v1/complaints', complaintRoutes);
app.use('/api/v1/reviews', reviewRoutes);
app.use('/api/v1/cms', cmsRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/chats', chatRoutes);
app.use('/api/v1/uploads', uploadRoutes);
app.use('/api/v1/contact', contactRoutes);
app.use('/api/v1/admin', adminRoutes);

app.use(notFound);
app.use(globalErrorHandler);

export default app;
