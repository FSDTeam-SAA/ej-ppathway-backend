import { StatusCodes } from 'http-status-codes';

const globalErrorHandler = (err, req, res, _next) => {
  let statusCode = err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR;
  let message = err.message || 'Something went wrong';
  let errors;

  if (err.name === 'MulterError') {
    statusCode = StatusCodes.BAD_REQUEST;
    message = err.message;
  }

  if (err.name === 'ValidationError') {
    statusCode = StatusCodes.BAD_REQUEST;
    errors = Object.values(err.errors || {}).map((e) => ({ path: e.path, message: e.message }));
    message = errors[0]?.message || 'Validation failed';
  }

  if (err.name === 'CastError') {
    statusCode = StatusCodes.BAD_REQUEST;
    message = `Invalid ${err.path}: ${err.value}`;
  }

  if (err.code === 11000) {
    statusCode = StatusCodes.CONFLICT;
    const dupField = Object.keys(err.keyValue || {})[0];
    message = dupField ? `${dupField} already exists` : 'Duplicate value';
  }

  if (err.http_code) {
    statusCode = err.http_code;
  }

  if (process.env.NODE_ENV !== 'test') {
    console.error(`[error] ${req.method} ${req.originalUrl} -> ${message}`);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(errors && { errors }),
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
};

export default globalErrorHandler;
