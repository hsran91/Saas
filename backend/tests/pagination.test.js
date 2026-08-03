const test = require("node:test");
const assert = require("node:assert/strict");

const { getPagination } = require("../utils/pagination");

test("getPagination applies defaults", () => {
  const result = getPagination({}, { defaultLimit: 50, maxLimit: 200 });

  assert.deepEqual(result, {
    page: 1,
    limit: 50,
    skip: 0
  });
});

test("getPagination clamps invalid and oversized values", () => {
  const result = getPagination({ page: "0", limit: "9999" }, { defaultLimit: 50, maxLimit: 200 });

  assert.deepEqual(result, {
    page: 1,
    limit: 200,
    skip: 0
  });
});

test("getPagination calculates skip from page and limit", () => {
  const result = getPagination({ page: "3", limit: "25" }, { defaultLimit: 50, maxLimit: 200 });

  assert.deepEqual(result, {
    page: 3,
    limit: 25,
    skip: 50
  });
});