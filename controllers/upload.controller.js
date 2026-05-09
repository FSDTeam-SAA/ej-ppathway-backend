import { Readable } from 'stream';
import { StatusCodes } from 'http-status-codes';
import cloudinary from '../config/cloudinary.js';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';

const streamUpload = (buffer, folder = 'express-uploads') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    Readable.from(buffer).pipe(uploadStream);
  });
};

export const uploadImage = catchAsync(async (req, res) => {
  if (!req.file) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Please upload an image file');
  }

  const folder = req.body.folder || 'express-uploads';
  const result = await streamUpload(req.file.buffer, folder);

  res.status(StatusCodes.CREATED).json({
    success: true,
    message: 'Image uploaded successfully',
    data: {
      public_id: result.public_id,
      secure_url: result.secure_url,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes
    }
  });
});

export const deleteImage = catchAsync(async (req, res) => {
  const { publicId } = req.params;

  if (!publicId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'publicId is required');
  }

  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: 'image'
  });

  if (result.result !== 'ok' && result.result !== 'not found') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to delete image from Cloudinary');
  }

  res.status(StatusCodes.OK).json({
    success: true,
    message: 'Image delete request processed successfully',
    data: result
  });
});
