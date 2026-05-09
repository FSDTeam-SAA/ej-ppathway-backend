import 'dotenv/config';
import http from 'http';
import app from './app.js';
import connectDB from './config/db.js';
import initSocket from './sockets/index.js';
import { ensureSeed } from './scripts/ensureSeed.js';

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();
  await ensureSeed();

  const server = http.createServer(app);
  const io = initSocket(server);
  app.set('io', io);

  server.listen(PORT, () => {
    console.log(`🚀 Prophetic Pathway API running on port ${PORT} (${process.env.NODE_ENV || 'dev'})`);
  });

  process.on('unhandledRejection', (error) => {
    console.error('UNHANDLED REJECTION!', error);
    server.close(() => process.exit(1));
  });

  process.on('uncaughtException', (error) => {
    console.error('UNCAUGHT EXCEPTION!', error);
    process.exit(1);
  });
};

start().catch((e) => {
  console.error('Failed to start server', e);
  process.exit(1);
});
