import fs from 'fs';
import path from 'path';
import {
  hasS3,
  EGRESS_OUTPUT_DIR,
  getRecordingPublicUrl
} from '../config/livekit.js';
import {
  objectStorageConfigured,
  parseObjectStorageUrl,
  uploadFileToObjectStorage
} from './upload.service.js';

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
 * - S3/R2 egress mode: LiveKit already uploaded; use the reported location
 *   or the derived public URL.
 * - Local egress mode: upload the local mp4 to R2, then remove the temp file.
 */
export const resolveRecordingUrl = async (egressInfo) => {
  const results =
    egressInfo?.fileResults ||
    (egressInfo?.file ? [egressInfo.file] : []) ||
    [];
  const first = results[0] || {};
  const location = first.location || '';
  const filename = first.filename || '';

  if (hasS3()) {
    if (filename) return getRecordingPublicUrl(filename);
    if (parseObjectStorageUrl(location)) return location;
    if (location && !location.startsWith('http')) return getRecordingPublicUrl(location);
    if (location) {
      try {
        const url = new URL(location);
        const parts = url.pathname.replace(/^\/+/, '').split('/');
        const key = parts.slice(1).join('/') || parts.join('/');
        if (key) return getRecordingPublicUrl(key);
      } catch {
        // keep the original below
      }
      return location;
    }
    return '';
  }

  const localPath = resolveLocalPath(filename || location);
  if (localPath && objectStorageConfigured()) {
    const uploaded = await uploadFileToObjectStorage(
      localPath,
      'recordings',
      'video',
      {
        filename: path.basename(localPath),
        contentType: 'video/mp4'
      }
    );
    if (uploaded?.secure_url) {
      try {
        fs.unlinkSync(localPath);
      } catch {
        // ignore cleanup failure
      }
      return uploaded.secure_url;
    }
  }

  if (filename) return getRecordingPublicUrl(filename);
  if (location) return location;
  return '';
};

export default { resolveRecordingUrl };
