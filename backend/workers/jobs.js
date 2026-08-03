const AccessLog = require("../models/AccessLog");
const { registerJobHandler } = require("../services/jobQueue");
const { logInfo } = require("../utils/logger");

let registered = false;

function registerDefaultJobHandlers() {
  if (registered) {
    return;
  }

  registerJobHandler("access-log.write", async (payload) => {
    await AccessLog.create(payload);
  });

  registerJobHandler("report.generate", async (payload, job) => {
    logInfo("Report job processed", {
      jobId: String(job._id),
      payload
    });
  });

  registerJobHandler("notification.dispatch", async (payload, job) => {
    logInfo("Notification job processed", {
      jobId: String(job._id),
      payload
    });
  });

  registered = true;
}

module.exports = {
  registerDefaultJobHandlers
};