import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { pool } from './config/db.js';
import authRoutes from './modules/auth/routes.js';
import programRoutes from './modules/programs/routes.js';
import applicationRoutes from './modules/applications/routes.js';
import interviewRoutes from './modules/interviews/routes.js';
import documentRoutes from './modules/documents/routes.js';
import notificationRoutes from './modules/notifications/routes.js';
import donationRoutes from './modules/donations/routes.js';
import dropoutRoutes from './modules/dropout/routes.js';
import impactRoutes from './modules/impact/routes.js';
import profileRoutes from './modules/profiles/routes.js';
import { startJobs } from './jobs/scheduler.js';
import { errorHandler, notFound } from './middleware/error.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: (process.env.CLIENT_URL || 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim()),
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false })); // SSLCommerz IPN posts form-encoded
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use('/api/auth', authRoutes);
app.use('/api/programs', programRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api', interviewRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api', donationRoutes);
app.use('/api/dropout', dropoutRoutes);
app.use('/api', impactRoutes);
app.use('/api/me', profileRoutes);

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up', service: process.env.APP_NAME || 'Alokdaar' });
  } catch (err) {
    res.status(503).json({ ok: false, db: 'down', error: err.message });
  }
});

app.get('/api', (_req, res) => {
  res.json({
    name: process.env.APP_NAME || 'Alokdaar',
    docs: 'See docs/ARCHITECTURE.md',
    endpoints: [
      '/api/health',
      'POST /api/auth/register',
      'POST /api/auth/verify-otp',
      'POST /api/auth/resend-otp',
      'POST /api/auth/login',
      'GET  /api/auth/me',
      'POST /api/auth/refresh',
      'POST /api/auth/logout',
      'POST /api/auth/logout-all',
      'GET  /api/auth/sessions',
      'POST /api/programs',
      'GET  /api/programs',
      'GET  /api/programs/:id',
      'PATCH /api/programs/:id',
      'POST /api/programs/:id/publish',
      'POST /api/programs/:id/pause',
      'POST /api/programs/:id/resume',
      'POST /api/programs/:id/close',
      'GET  /api/programs/:id/weights',
      'PUT  /api/programs/:id/weights',
      'GET  /api/programs/:id/applications',
      'POST /api/programs/:id/bulk-decide',
      'GET  /api/applications/:id',
      'POST /api/applications/:id/pre-approve-check',
      'POST /api/applications/:id/decide',
      'GET  /api/programs/:id/waitlist',
      'PUT  /api/programs/:id/waitlist/reorder',
      'POST /api/programs/:id/waitlist/:applicationId/promote',
      'POST /api/applications/:id/withdraw',
      'GET  /api/programs/:id/slots',
      'POST /api/programs/:id/slots',
      'DELETE /api/slots/:id',
      'GET  /api/programs/:id/slots/available',
      'POST /api/applications/:id/interview',
      'GET  /api/applications/:id/interview',
      'GET  /api/programs/:id/interviews',
      'GET  /api/interviews/mine',
      'POST /api/interviews/:id/reschedule',
      'POST /api/interviews/:id/status',
      'POST /api/interviews/:id/request-slot',
      'GET  /api/documents',
      'POST /api/documents/upload-sign',
      'POST /api/documents',
      'GET  /api/documents/:id',
      'POST /api/documents/:id/confirm',
      'DELETE /api/documents/:id',
      'GET  /api/documents/queue',
      'POST /api/documents/:id/verify',
      'POST /api/documents/:id/reject',
      'GET  /api/notifications',
      'POST /api/notifications/:id/read',
      'POST /api/notifications/read-all',
      'GET  /api/notifications/preferences',
      'PUT  /api/notifications/preferences',
      'POST /api/notifications/sms/inbound',
      'GET  /api/campaigns',
      'GET  /api/campaigns/:id',
      'POST /api/donations/order',
      'POST /api/donations/ipn',
      'GET  /api/donations/:id/status',
      'GET  /api/donations/mine',
      'POST /api/donations/:id/recurring/pause|resume|cancel',
      'GET  /api/donations/:id/receipt',
      'GET  /api/donations/impact',
      'GET  /api/providers/donations',
      'GET  /api/me/profile',
      'PUT  /api/me/profile',
      'POST /api/dropout/recompute',
      'GET  /api/dropout/cases',
      'GET  /api/dropout/cases/:id',
      'POST /api/dropout/cases/:id/notes',
      'POST /api/dropout/cases/:id/status',
      'POST /api/dropout/cases/:id/recommend',
      'GET  /api/impact/public',
      'GET  /api/impact/summary',
      'GET  /api/impact/districts/:district',
      'GET  /api/analytics/overview',
    ],
  });
});

app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT} (${process.env.NODE_ENV || 'development'})`);
  startJobs();
});
