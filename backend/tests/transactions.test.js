const test = require("node:test");
const assert = require("node:assert/strict");

const { supportsTransactionsForTopology, getTransactionReadiness } = require("../services/transactions");

test("supportsTransactionsForTopology accepts replica set and sharded clusters", () => {
  assert.equal(supportsTransactionsForTopology("ReplicaSetWithPrimary"), true);
  assert.equal(supportsTransactionsForTopology("Sharded"), true);
});

test("supportsTransactionsForTopology rejects standalone and unknown topologies", () => {
  assert.equal(supportsTransactionsForTopology("Single"), false);
  assert.equal(supportsTransactionsForTopology("Unknown"), false);
  assert.equal(supportsTransactionsForTopology(undefined), false);
});

test("getTransactionReadiness reports failure when transactions are required on unsupported topology", () => {
  const result = getTransactionReadiness({ requireTransactions: true });

  assert.equal(result.required, true);
  assert.equal(result.capable, false);
  assert.equal(result.ready, false);
  assert.match(result.error, /require a replica set or sharded cluster/);
});