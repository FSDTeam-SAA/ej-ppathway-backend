import { Readable } from 'stream';
import cloudinary from '../config/cloudinary.js';

export const uploadBufferToCloudinary = (buffer, folder = 'prophetic-pathway', resourceType = 'auto') =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    Readable.from(buffer).pipe(uploadStream);
  });

export const deleteCloudinary = async (publicId, resourceType = 'image') => {
  try {
    return await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch {
    return null;
  }
};

export default { uploadBufferToCloudinary, deleteCloudinary };
