import Job from '../models/job.model.js';

const handlers = new Map();

let workerTimer = null;
let workerStarted = false;
let workerDraining = false;
let activeJobs = 0;
let workerConcurrency = 2;
let workerPollMs = 1000;

const lockTimeoutMs = () => Number(process.env.JOB_LOCK_TIMEOUT_MS || 5 * 60 * 1000);
const retryBaseMs = () => Number(process.env.JOB_RETRY_BASE_MS || 10 * 1000);
const retryMaxMs = () => Number(process.env.JOB_RETRY_MAX_MS || 5 * 60 * 1000);

const buildRunAt = ({ runAt, delayMs } = {}) => {
  if (runAt) return new Date(runAt);
  return new Date(Date.now() + Math.max(0, Number(delayMs) || 0));
};

const retryDelayMs = (attempts) => {
  const delay = retryBaseMs() * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(delay, retryMaxMs());
};

export const registerJobHandler = (type, handler) => {
  if (!type || typeof handler !== 'function') {
    throw new Error('registerJobHandler requires a job type and handler');
  }
  handlers.set(type, handler);
};

export const enqueueJob = async (type, payload = {}, options = {}) => {
  return Job.create({
    type,
    payload,
    maxAttempts: Number(options.maxAttempts || process.env.JOB_MAX_ATTEMPTS || 3),
    runAt: buildRunAt(options)
  });
};

export const enqueueBulkJobs = async (type, payloads = [], options = {}) => {
  if (!Array.isArray(payloads) || payloads.length === 0) return [];
  const maxAttempts = Number(options.maxAttempts || process.env.JOB_MAX_ATTEMPTS || 3);
  const runAt = buildRunAt(options);
  const docs = payloads.map((payload) => ({
    type,
    payload,
    maxAttempts,
    runAt
  }));
  return Job.insertMany(docs, { ordered: false });
};

const claimNextJob = async () => {
  const types = Array.from(handlers.keys());
  if (types.length === 0) return null;

  const now = new Date();
  const staleBefore = new Date(Date.now() - lockTimeoutMs());

  return Job.findOneAndUpdate(
    {
      type: { $in: types },
      $or: [
        { status: 'pending', runAt: { $lte: now } },
        { status: 'processing', lockedAt: { $lte: staleBefore } }
      ]
    },
    {
      $set: { status: 'processing', lockedAt: now, lastError: '' },
      $inc: { attempts: 1 }
    },
    { sort: { runAt: 1, createdAt: 1 }, new: true }
  );
};

const processJob = async (job) => {
  const handler = handlers.get(job.type);
  if (!handler) {
    await Job.updateOne(
      { _id: job._id },
      {
        status: 'failed',
        failedAt: new Date(),
        lockedAt: null,
        lastError: `No handler registered for job type "${job.type}"`
      }
    );
    return;
  }

  try {
    const result = await handler(job.payload, job);
    await Job.updateOne(
      { _id: job._id },
      {
        status: 'completed',
        completedAt: new Date(),
        lockedAt: null,
        lastError: '',
        result
      }
    );
  } catch (error) {
    const attempts = Number(job.attempts || 1);
    const maxAttempts = Number(job.maxAttempts || 3);
    const canRetry = attempts < maxAttempts;

    await Job.updateOne(
      { _id: job._id },
      {
        status: canRetry ? 'pending' : 'failed',
        runAt: canRetry ? new Date(Date.now() + retryDelayMs(attempts)) : job.runAt,
        lockedAt: null,
        failedAt: canRetry ? null : new Date(),
        lastError: error?.message || String(error)
      }
    );
  }
};

const drainQueue = async () => {
  if (!workerStarted || workerDraining) return;
  workerDraining = true;

  try {
    while (activeJobs < workerConcurrency) {
      const job = await claimNextJob();
      if (!job) break;

      activeJobs += 1;
      processJob(job)
        .catch((error) => console.error('[jobs] worker error:', error?.message || error))
        .finally(() => {
          activeJobs -= 1;
          setImmediate(drainQueue);
        });
    }
  } catch (error) {
    console.error('[jobs] drain error:', error?.message || error);
  } finally {
    workerDraining = false;
  }
};

export const startJobWorker = ({
  concurrency = Number(process.env.JOB_WORKER_CONCURRENCY || 2),
  pollMs = Number(process.env.JOB_WORKER_POLL_MS || 1000)
} = {}) => {
  if (process.env.JOB_WORKER_ENABLED === 'false') {
    console.log('[jobs] Worker disabled by JOB_WORKER_ENABLED=false');
    return;
  }
  if (workerStarted) return;

  workerConcurrency = Math.max(1, concurrency);
  workerPollMs = Math.max(250, pollMs);
  workerStarted = true;
  workerTimer = setInterval(drainQueue, workerPollMs);
  workerTimer.unref?.();
  setImmediate(drainQueue);

  console.log(`[jobs] Worker started (${workerConcurrency} concurrency, ${workerPollMs}ms poll)`);
};

export const stopJobWorker = () => {
  workerStarted = false;
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
};

export const getJobQueueStatus = () => ({
  enabled: workerStarted,
  activeJobs,
  concurrency: workerConcurrency,
  pollMs: workerPollMs,
  handlers: Array.from(handlers.keys())
});

export default {
  registerJobHandler,
  enqueueJob,
  enqueueBulkJobs,
  startJobWorker,
  stopJobWorker,
  getJobQueueStatus
};
