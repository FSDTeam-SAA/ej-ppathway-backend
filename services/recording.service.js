import fs from 'fs';
import path from 'path';
import cloudinary from '../config/cloudinary.js';
import {
  hasS3,
  EGRESS_OUTPUT_DIR,
  getRecordingPublicUrl
} from '../config/livekit.js';

export const cloudinaryConfigured = () =>
  !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

/**
 * Upload a local video file to Cloudinary (chunked, handles large files).
 * Returns { url, publicId } or null on failure.
 */
const uploadLocalFileToCloudinary = (localPath) =>
  new Promise((resolve) => {
    cloudinary.uploader.upload_large(
      localPath,
      {
        resource_type: 'video',
        folder: 'session_recordings',
        use_filename: true,
        unique_filename: true,
        overwrite: false
      },
      (error, result) => {
        if (error || !result?.secure_url) {
          console.error('Cloudinary recording upload failed:', error?.message || 'no result');
          return resolve(null);
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
  });

/**
 * Best-effort resolution of the local file path the egress wrote, given the
 * filename/location reported in the webhook. Tolerates path differences between
 * the egress container and the backend by also checking the shared output dir.
 */
const resolveLocalPath = (reported) => {
  if (!reported) return null;
  const candidates = [
    reported,
    path.join(EGRESS_OUTPUT_DIR, 'recordings', path.basename(reported)),
    path.join(EGRESS_OUTPUT_DIR, path.basename(reported))
  ];
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }
  return null;
};

/**
 * Given a finished egress, return the public recording URL to persist.
 *
 * - S3 mode: LiveKit already uploaded; use the reported location (or our derived URL).
 * - Local mode: forward the file to Cloudinary if configured; otherwise serve it
 *   from the configured public base URL.
 */
export const resolveRecordingUrl = async (egressInfo) => {
  const results =
    egressInfo?.fileResults ||
    (egressInfo?.file ? [egressInfo.file] : []) ||
    [];
  const first = results[0] || {};
  const location = first.location || '';
  const filename = first.filename || '';

  // S3 / cloud-native egress upload: the location is already a usable URL/key.
  if (hasS3()) {
    if (location) return location;
    if (filename) return getRecordingPublicUrl(filename);
    return '';
  }

  // Local egress file -> forward to Cloudinary when available.
  const localPath = resolveLocalPath(filename || location);
  if (localPath && cloudinaryConfigured()) {
    const uploaded = await uploadLocalFileToCloudinary(localPath);
    if (uploaded?.url) {
      // Clean up the temp file once it is safely in Cloudinary.
      try {
        fs.unlinkSync(localPath);
      } catch {
        // ignore cleanup failure
      }
      return uploaded.url;
    }
  }

  // Fallback: serve the local file from a configured public base URL.
  if (filename) return getRecordingPublicUrl(filename);
  if (location) return location;
  return '';
};

export default { cloudinaryConfigured, resolveRecordingUrl };
