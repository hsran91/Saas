const mongoose = require("mongoose");
const { logWarn } = require("../utils/logger");

const REQUIRE_DB_TRANSACTIONS = process.env.REQUIRE_DB_TRANSACTIONS === "true";
let warnedAboutFallback = false;

function supportsTransactionsForTopology(topologyType) {
  return topologyType === "ReplicaSetWithPrimary" || topologyType === "Sharded";
}

function isTransactionCapable() {
  const topologyType = mongoose.connection?.client?.topology?.description?.type;
  return supportsTransactionsForTopology(topologyType);
}

function getTransactionReadiness(options = {}) {
  const topologyType = mongoose.connection?.client?.topology?.description?.type || "unknown";
  const capable = supportsTransactionsForTopology(topologyType);
  const required = options.requireTransactions ?? REQUIRE_DB_TRANSACTIONS;

  return {
    required,
    capable,
    topologyType,
    ready: required ? capable : true,
    error: required && !capable
      ? "MongoDB transactions require a replica set or sharded cluster"
      : null
  };
}

async function runWriteTransaction(work, options = {}) {
  const readiness = getTransactionReadiness(options);

  if (!readiness.capable) {
    if (readiness.required) {
      throw new Error(readiness.error);
    }

    if (!warnedAboutFallback) {
      warnedAboutFallback = true;
      logWarn("Falling back to non-transactional writes because MongoDB topology does not support transactions", {
        topologyType: readiness.topologyType
      });
    }

    return work(null);
  }

  const session = await mongoose.startSession();

  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    }, {
      readPreference: "primary",
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" }
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  runWriteTransaction,
  supportsTransactionsForTopology,
  getTransactionReadiness
};