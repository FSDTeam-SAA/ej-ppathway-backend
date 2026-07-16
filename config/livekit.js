import path from 'path';
import {
  AccessToken,
  RoomServiceClient,
  EgressClient,
  EncodedFileType,
  EncodedFileOutput,
  S3Upload,
  WebhookReceiver
} from 'livekit-server-sdk';

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

const httpUrl = LIVEKIT_URL ? LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:') : '';

const roomService = LIVEKIT_URL
  ? new RoomServiceClient(httpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
  : null;

const egressClient = LIVEKIT_URL
  ? new EgressClient(httpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
  : null;

const webhookReceiver = LIVEKIT_API_KEY && LIVEKIT_API_SECRET
  ? new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
  : null;

export const isLiveKitConfigured = () => !!LIVEKIT_URL;

/**
 * S3-compatible storage config for egress recordings.
 * Works with AWS S3, MinIO, Cloudflare R2, Wasabi, etc.
 * When unset, egress falls back to writing to the egress container's local filesystem.
 */
const EGRESS_S3 = {
  accessKey: process.env.EGRESS_S3_ACCESS_KEY || process.env.R2_ACCESS_KEY_ID || process.env.STORAGE_S3_ACCESS_KEY,
  secret: process.env.EGRESS_S3_SECRET || process.env.R2_SECRET_ACCESS_KEY || process.env.STORAGE_S3_SECRET,
  bucket: process.env.EGRESS_S3_BUCKET || process.env.R2_PRIVATE_BUCKET || process.env.R2_BUCKET || process.env.STORAGE_S3_BUCKET,
  region: process.env.EGRESS_S3_REGION || process.env.R2_REGION || process.env.STORAGE_S3_REGION || 'auto',
  endpoint: process.env.EGRESS_S3_ENDPOINT || process.env.R2_ENDPOINT || process.env.STORAGE_S3_ENDPOINT,
  forcePathStyle: String(process.env.EGRESS_S3_FORCE_PATH_STYLE || process.env.R2_FORCE_PATH_STYLE || process.env.STORAGE_S3_FORCE_PATH_STYLE || 'true') === 'true'
};

export const hasS3 = () => !!(EGRESS_S3.accessKey && EGRESS_S3.secret && EGRESS_S3.bucket);

/**
 * Directory (inside the egress container) where recordings are written when NOT using S3.
 * This path is mounted to a shared volume so the backend can read the file and forward it
 * to R2/S3-compatible object storage. Both containers must mount the same host
 * directory at this path.
 */
export const EGRESS_OUTPUT_DIR = (process.env.EGRESS_OUTPUT_DIR || '/recordings').replace(/\/+$/, '');

/**
 * Public base URL where recordings can be streamed from (CDN / public bucket / proxy).
 * Used to build a best-effort recordingUrl immediately at start time. The authoritative
 * URL is later confirmed by the LiveKit egress webhook (see webhook.controller.js).
 */
const explicitRecordingPublicBase = (
  process.env.RECORDING_PUBLIC_BASE_URL ||
  process.env.EGRESS_S3_PUBLIC_BASE_URL ||
  process.env.STORAGE_PUBLIC_BASE_URL ||
  ''
).replace(/\/+$/, '');

const r2PublicBucket = process.env.R2_PUBLIC_BUCKET || process.env.R2_BUCKET;
const r2PublicBase = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

const recordingPublicBase =
  explicitRecordingPublicBase ||
  (r2PublicBase && EGRESS_S3.bucket && EGRESS_S3.bucket === r2PublicBucket ? r2PublicBase : '');

/**
 * Build a public URL for a recording given its storage filepath.
 */
export const getRecordingPublicUrl = (filepath) => {
  if (!filepath) return '';
  const clean = String(filepath).replace(/^\/+/, '');
  if (recordingPublicBase) return `${recordingPublicBase}/${clean}`;
  if (EGRESS_S3.bucket) return `r2://${EGRESS_S3.bucket}/${clean}`;
  // Fall back to a path-style S3/MinIO URL when an endpoint is configured.
  if (EGRESS_S3.endpoint && EGRESS_S3.bucket) {
    const base = EGRESS_S3.endpoint.replace(/\/+$/, '');
    return `${base}/${EGRESS_S3.bucket}/${clean}`;
  }
  return clean;
};

/**
 * Generate access token for a participant joining a LiveKit room
 */
export const generateLiveKitToken = async ({ identity, name, roomName, metadata, ttlSeconds = 60 * 60 * 4 }) => {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name,
    metadata: metadata ? JSON.stringify(metadata) : undefined,
    ttl: ttlSeconds
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  });

  const token = await at.toJwt();
  return { token, url: LIVEKIT_URL };
};

export const createRoom = async (roomName, opts = {}) => {
  if (!roomService) return null;
  try {
    return await roomService.createRoom({
      name: roomName,
      emptyTimeout: opts.emptyTimeout || 300,
      maxParticipants: opts.maxParticipants || 2,
      metadata: opts.metadata ? JSON.stringify(opts.metadata) : undefined
    });
  } catch (e) {
    if (String(e?.message || '').includes('already exists')) return null;
    throw e;
  }
};

export const deleteRoom = async (roomName) => {
  if (!roomService) return null;
  try {
    await roomService.deleteRoom(roomName);
  } catch (e) {
    // ignore not found errors
  }
};

export const listParticipants = async (roomName) => {
  if (!roomService) return [];
  try {
    return await roomService.listParticipants(roomName);
  } catch {
    return [];
  }
};

export const removeParticipant = async (roomName, identity) => {
  if (!roomService) return null;
  try {
    await roomService.removeParticipant(roomName, identity);
  } catch {
    // ignore
  }
};

/**
 * Start a room-composite recording.
 *
 * Storage is chosen by what is configured in the environment:
 *   - EGRESS_S3_* present  -> egress uploads straight to S3-compatible storage
 *                             (AWS S3, MinIO, Cloudflare R2, Wasabi, …)
 *   - otherwise            -> egress writes to a local file on a shared volume,
 *                             which the webhook handler forwards to R2/S3 storage
 *                             (or serves directly if neither is configured).
 *
 * `nameOnly` is just the file name (e.g. "<sessionId>-<ts>.mp4").
 * Returns { egressId, filepath, storage, recordingUrl } or null on failure.
 */
export const startRoomRecording = async (roomName, nameOnly) => {
  if (!egressClient) {
    console.error('startRoomRecording error: LiveKit egress is not configured', { roomName });
    return null;
  }
  try {
    const useS3 = hasS3();
    // S3: key within the bucket. Local: absolute path inside the shared egress volume.
    const filepath = useS3
      ? `recordings/${nameOnly}`
      : path.posix.join(EGRESS_OUTPUT_DIR, nameOnly);

    const fileOutputConfig = {
      fileType: EncodedFileType.MP4,
      filepath
    };

    if (useS3) {
      fileOutputConfig.output = {
        case: 's3',
        value: new S3Upload({
          accessKey: EGRESS_S3.accessKey,
          secret: EGRESS_S3.secret,
          bucket: EGRESS_S3.bucket,
          region: EGRESS_S3.region,
          ...(EGRESS_S3.endpoint ? { endpoint: EGRESS_S3.endpoint } : {}),
          forcePathStyle: EGRESS_S3.forcePathStyle
        })
      };
    }

    const fileOutput = new EncodedFileOutput(fileOutputConfig);
    const info = await egressClient.startRoomCompositeEgress(roomName, { file: fileOutput });
    return {
      egressId: info?.egressId,
      filepath,
      storage: useS3 ? 's3' : 'local',
      // Only S3 has a stable public URL up front; local R2 upload resolves on the webhook.
      recordingUrl: useS3 ? getRecordingPublicUrl(filepath) : ''
    };
  } catch (e) {
    console.error('startRoomRecording error', { roomName, message: e?.message });
    return null;
  }
};

export const stopEgress = async (egressId) => {
  if (!egressClient || !egressId) return null;
  try {
    return await egressClient.stopEgress(egressId);
  } catch (e) {
    console.error('stopEgress error', { egressId, message: e?.message });
    return null;
  }
};

/**
 * Validate and parse an incoming LiveKit webhook request.
 * `body` must be the raw request body (string or Buffer); `authHeader` is the Authorization header.
 * Returns the decoded event, or null when not verifiable.
 */
export const receiveWebhookEvent = async (body, authHeader) => {
  if (!webhookReceiver) return null;
  const raw = Buffer.isBuffer(body) ? body.toString('utf8') : body;
  return webhookReceiver.receive(raw, authHeader);
};

export default {
  isLiveKitConfigured,
  generateLiveKitToken,
  createRoom,
  deleteRoom,
  listParticipants,
  removeParticipant,
  startRoomRecording,
  stopEgress,
  getRecordingPublicUrl,
  receiveWebhookEvent
};
