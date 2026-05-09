export const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

export const buildMeta = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit))
});

export default { parsePagination, buildMeta };
