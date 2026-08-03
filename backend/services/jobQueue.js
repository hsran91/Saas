const Job = require("../models/Job");
const { logError } = require("../utils/logger");

const handlers = new Map();
const JOB_POLL_INTERVAL_MS = Number(process.env.JOB_POLL_INTERVAL_MS || 3000);
const JOB_MAX_PER_TICK = Number(process.env.JOB_MAX_PER_TICK || 20);

let workerTimer = null;
let isProcessing = false;

function registerJobHandler(type, handler) {
  handlers.set(type, handler);
}

async function enqueueJob({ type, tenantId, correlationId, payload, availableAt, maxAttempts }) {
  return Job.create({
    type,
    tenantId,
    correlationId,
    payload,
    availableAt: availableAt || new Date(),
    maxAttempts: maxAttempts || 5
  });
}

function getRetryDelayMs(attempts) {
  return Math.min(30000, 1000 * attempts * attempts);
}

async function claimNextJob() {
  return Job.findOneAndUpdate(
    {
      status: "pending",
      availableAt: { $lte: new Date() }
    },
    {
      $set: {
        status: "running",
        lockedAt: new Date()
      },
      $inc: {
        attempts: 1
      }
    },
    {
      sort: { availableAt: 1, createdAt: 1 },
      new: true
    }
  );
}

async function processSingleJob() {
  const job = await claimNextJob();
  if (!job) {
    return false;
  }

  const handler = handlers.get(job.type);

  if (!handler) {
    await Job.updateOne(
      { _id: job._id },
      {
        $set: {
          status: "failed",
          finishedAt: new Date(),
          lastError: `No handler registered for job type ${job.type}`
        }
      }
    );
    return true;
  }

  try {
    await handler(job.payload, job);
    await Job.updateOne(
      { _id: job._id },
      {
        $set: {
          status: "completed",
          finishedAt: new Date(),
          lockedAt: null,
          lastError: ""
        }
      }
    );
  } catch (err) {
    const shouldRetry = job.attempts < job.maxAttempts;
    await Job.updateOne(
      { _id: job._id },
      {
        $set: {
          status: shouldRetry ? "pending" : "failed",
          lockedAt: null,
          finishedAt: shouldRetry ? null : new Date(),
          availableAt: new Date(Date.now() + getRetryDelayMs(job.attempts)),
          lastError: err.message
        }
      }
    );

    if (!shouldRetry) {
      logError("Job permanently failed", {
        jobId: String(job._id),
        type: job.type,
        error: err.message
      });
    }
  }

  return true;
}

async function processJobs() {
  if (isProcessing) {
    return;
  }

  isProcessing = true;
  try {
    for (let index = 0; index < JOB_MAX_PER_TICK; index += 1) {
      const handled = await processSingleJob();
      if (!handled) {
        break;
      }
    }
  } finally {
    isProcessing = false;
  }
}

function startJobWorker() {
  if (workerTimer) {
    return workerTimer;
  }

  workerTimer = setInterval(() => {
    void processJobs();
  }, JOB_POLL_INTERVAL_MS);

  if (typeof workerTimer.unref === "function") {
    workerTimer.unref();
  }

  return workerTimer;
}

module.exports = {
  registerJobHandler,
  enqueueJob,
  startJobWorker
};