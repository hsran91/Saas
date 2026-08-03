function parsePositiveInt(value) {
  if (value == null || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function getPagination(query = {}, options = {}) {
  const defaultLimit = options.defaultLimit || 50;
  const maxLimit = options.maxLimit || 100;
  const defaultPage = options.defaultPage || 1;

  const limit = Math.min(maxLimit, parsePositiveInt(query.limit) || defaultLimit);
  const page = parsePositiveInt(query.page) || defaultPage;
  const skip = (page - 1) * limit;

  return {
    page,
    limit,
    skip
  };
}

function setPaginationHeaders(res, pagination, resultCount) {
  res.setHeader("x-pagination-page", String(pagination.page));
  res.setHeader("x-pagination-limit", String(pagination.limit));

  if (typeof resultCount === "number") {
    res.setHeader("x-pagination-returned", String(resultCount));
    res.setHeader("x-pagination-has-more", String(resultCount === pagination.limit));
  }
}

module.exports = {
  getPagination,
  setPaginationHeaders
};