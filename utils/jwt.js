import jwt from 'jsonwebtoken';

export const signAccessToken = (payload) =>
  jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '7d'
  });

export const signRefreshToken = (payload) =>
  jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d'
  });

export const signResetToken = (payload) =>
  jwt.sign(payload, process.env.JWT_RESET_SECRET, {
    expiresIn: process.env.JWT_RESET_EXPIRES_IN || '15m'
  });

export const verifyAccessToken = (token) =>
  jwt.verify(token, process.env.JWT_ACCESS_SECRET);

export const verifyRefreshToken = (token) =>
  jwt.verify(token, process.env.JWT_REFRESH_SECRET);

export const verifyResetToken = (token) =>
  jwt.verify(token, process.env.JWT_RESET_SECRET);

export default {
  signAccessToken,
  signRefreshToken,
  signResetToken,
  verifyAccessToken,
  verifyRefreshToken,
  verifyResetToken
};
