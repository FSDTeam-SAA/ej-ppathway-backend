import 'dotenv/config';
import http from 'http';
import app from './app.js';
import connectDB from './config/db.js';
import initSocket from './sockets/index.js';
import { ensureSeed } from './scripts/ensureSeed.js';
import { startJobWorker, stopJobWorker } from './services/jobQueue.service.js';
import { registerNotificationJobHandlers } from './services/notificationJobs.service.js';

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();
  await ensureSeed();

  const server = http.createServer(app);
  const io = initSocket(server);
  app.set('io', io);
  registerNotificationJobHandlers({ io });
  startJobWorker();

  server.listen(PORT, () => {
    console.log(`🚀 Prophetic Pathway API running on port ${PORT} (${process.env.NODE_ENV || 'dev'})`);
  });

  process.on('unhandledRejection', (error) => {
    console.error('UNHANDLED REJECTION!', error);
    stopJobWorker();
    server.close(() => process.exit(1));
  });

  process.on('uncaughtException', (error) => {
    console.error('UNCAUGHT EXCEPTION!', error);
    stopJobWorker();
    process.exit(1);
  });
};

start().catch((e) => {
  console.error('Failed to start server', e);
  process.exit(1);
});
