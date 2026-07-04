import multer from 'multer';
import ApiError from '../utils/ApiError.js';
import { StatusCodes } from 'http-status-codes';

const storage = multer.memoryStorage();

const buildFilter = (allowed) => (req, file, cb) => {
  const ok = allowed.some((mt) => file.mimetype === mt || file.mimetype.startsWith(mt));
  if (ok) cb(null, true);
  else cb(new ApiError(StatusCodes.BAD_REQUEST, `Unsupported file type: ${file.mimetype}`), false);
};

export const imageUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: buildFilter(['image/'])
});

export const videoUpload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: buildFilter(['video/'])
});

export const introMediaUpload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: buildFilter(['video/', 'audio/'])
});

export const advisorApplicationUpload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedByField = {
      introVideo: ['video/', 'audio/'],
      profilePhoto: ['image/']
    };
    const allowed = allowedByField[file.fieldname];
    if (!allowed) {
      cb(new ApiError(StatusCodes.BAD_REQUEST, `Unsupported upload field: ${file.fieldname}`), false);
      return;
    }
    buildFilter(allowed)(req, file, cb);
  }
});

export const documentUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: buildFilter(['application/pdf', 'image/'])
});

export const anyUpload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

// keep default for backward compat
export default imageUpload;
