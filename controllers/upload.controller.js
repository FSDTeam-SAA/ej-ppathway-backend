import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import { deleteObjectStorage, uploadBufferToObjectStorage } from '../services/upload.service.js';

export const uploadImage = catchAsync(async (req, res) => {
  if (!req.file) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Please upload an image file');
  }

  const folder = req.body.folder || 'express-uploads';
  const result = await uploadBufferToObjectStorage(req.file.buffer, folder, 'image', {
    contentType: req.file.mimetype,
    filename: req.file.originalname
  });

  res.status(StatusCodes.CREATED).json({
    success: true,
    message: 'Image uploaded successfully',
    data: {
      public_id: result.public_id,
      secure_url: result.secure_url,
      url: result.url,
      key: result.key,
      bytes: result.bytes,
      contentType: result.contentType,
      provider: result.provider
    }
  });
});

export const deleteImage = catchAsync(async (req, res) => {
  const { publicId } = req.params;

  if (!publicId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'publicId is required');
  }

  const result = await deleteObjectStorage(publicId);

  res.status(StatusCodes.OK).json({
    success: true,
    message: 'Image delete request processed successfully',
    data: result
  });
});
