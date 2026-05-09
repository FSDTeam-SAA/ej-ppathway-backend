import { StatusCodes } from 'http-status-codes';

const sendResponse = (res, payload) => {
  const {
    statusCode = StatusCodes.OK,
    success = true,
    message,
    data,
    meta
  } = payload || {};

  const body = { success, message };
  if (typeof data !== 'undefined') body.data = data;
  if (typeof meta !== 'undefined') body.meta = meta;

  return res.status(statusCode).json(body);
};

export default sendResponse;
