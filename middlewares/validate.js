import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';

const validate = (schema) => (req, _res, next) => {
  try {
    const parsed = schema.parse({
      body: req.body,
      query: req.query,
      params: req.params
    });
    if (parsed.body) req.body = parsed.body;
    if (parsed.query) req.query = parsed.query;
    if (parsed.params) req.params = parsed.params;
    next();
  } catch (err) {
    const message = err?.issues?.[0]?.message || 'Validation failed';
    next(new ApiError(StatusCodes.BAD_REQUEST, message));
  }
};

export default validate;
