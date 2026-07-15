import { Router } from 'express';
import { auth } from '../middlewares/auth.js';
import { imageUpload, videoUpload, documentUpload } from '../middlewares/upload.js';
import { uploadImage, deleteImage } from '../controllers/upload.controller.js';
import { uploadBufferToObjectStorage } from '../services/upload.service.js';
import { StatusCodes } from 'http-status-codes';
import sendResponse from '../utils/sendResponse.js';
import catchAsync from '../utils/catchAsync.js';

const router = Router();

router.use(auth());

router.post('/image', imageUpload.single('image'), uploadImage);
router.delete('/image/:publicId', deleteImage);

router.post(
  '/video',
  videoUpload.single('video'),
  catchAsync(async (req, res) => {
    if (!req.file) return sendResponse(res, { statusCode: StatusCodes.BAD_REQUEST, success: false, message: 'video required' });
    const r = await uploadBufferToObjectStorage(req.file.buffer, req.body.folder || 'videos', 'video', {
      contentType: req.file.mimetype,
      filename: req.file.originalname
    });
    return sendResponse(res, { statusCode: StatusCodes.CREATED, data: r });
  })
);

router.post(
  '/document',
  documentUpload.single('document'),
  catchAsync(async (req, res) => {
    if (!req.file) return sendResponse(res, { statusCode: StatusCodes.BAD_REQUEST, success: false, message: 'document required' });
    const r = await uploadBufferToObjectStorage(req.file.buffer, req.body.folder || 'documents', 'auto', {
      contentType: req.file.mimetype,
      filename: req.file.originalname
    });
    return sendResponse(res, { statusCode: StatusCodes.CREATED, data: r });
  })
);

export default router;
