/**
 * Reusable pagination calculation helper
 * @param {number|string} page - Current requested page (1-indexed)
 * @param {number|string} limit - Items per page
 * @param {number} totalItems - Total count of items in DB collection
 * @returns {Object} Pagination metadata { page, limit, skip, totalItems, totalPages, hasPrev, hasNext, prevPage, nextPage }
 */
const getPagination = (page, limit = 12, totalItems = 0) => {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.max(1, parseInt(limit, 10) || 12);
  const totalPages = Math.max(1, Math.ceil(totalItems / l));
  const safePage = Math.min(p, totalPages);
  const skip = (safePage - 1) * l;

  return {
    page: safePage,
    limit: l,
    skip,
    totalItems,
    totalPages,
    hasPrev: safePage > 1,
    hasNext: safePage < totalPages,
    prevPage: safePage > 1 ? safePage - 1 : null,
    nextPage: safePage < totalPages ? safePage + 1 : null
  };
};

module.exports = { getPagination };
