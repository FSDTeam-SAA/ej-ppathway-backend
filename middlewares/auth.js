import { StatusCodes } from 'http-status-codes';
import ApiError from '../utils/ApiError.js';
import { verifyAccessToken } from '../utils/jwt.js';
import User from '../models/user.model.js';

export const auth = (...allowedRoles) => async (req, _res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return next(new ApiError(StatusCodes.UNAUTHORIZED, 'Authorization token missing'));
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch {
      return next(new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid or expired token'));
    }

    const user = await User.findById(decoded.sub).lean();
    if (!user) return next(new ApiError(StatusCodes.UNAUTHORIZED, 'User no longer exists'));
    if (user.status === 'suspended') return next(new ApiError(StatusCodes.FORBIDDEN, 'Your account is suspended'));
    if (user.status === 'deactivated') return next(new ApiError(StatusCodes.FORBIDDEN, 'Your account is deactivated'));

    if (allowedRoles.length && !allowedRoles.includes(user.role)) {
      // sub_admin permission gate
      if (user.role === 'sub_admin' && allowedRoles.includes('admin')) {
        // sub-admins can access admin endpoints if granted permission
      } else {
        return next(new ApiError(StatusCodes.FORBIDDEN, 'You do not have permission for this resource'));
      }
    }

    req.user = user;
    req.tokenPayload = decoded;
    next();
  } catch (e) {
    next(e);
  }
};

// Attaches req.user when a valid Bearer token is present, but never blocks the
// request when it is missing/invalid. Used by endpoints that personalize their
// response for logged-in users yet must also work for anonymous callers.
export const optionalAuth = () => async (req, _res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next();
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch {
      return next();
    }
    const user = await User.findById(decoded.sub).lean();
    if (user && user.status !== 'suspended' && user.status !== 'deactivated') {
      req.user = user;
      req.tokenPayload = decoded;
    }
    next();
  } catch {
    next();
  }
};

export const requirePermission = (...perms) => (req, _res, next) => {
  if (!req.user) return next(new ApiError(StatusCodes.UNAUTHORIZED, 'Not authenticated'));
  if (req.user.role === 'admin') return next();
  if (req.user.role === 'sub_admin') {
    const granted = req.user.permissions || [];
    const ok = perms.every((p) => granted.includes(p));
    if (!ok) return next(new ApiError(StatusCodes.FORBIDDEN, 'Insufficient permissions'));
    return next();
  }
  return next(new ApiError(StatusCodes.FORBIDDEN, 'Admins only'));
};

export default { auth, requirePermission };
