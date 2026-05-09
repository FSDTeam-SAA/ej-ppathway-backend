import { AccessToken, RoomServiceClient, EgressClient, EncodedFileType } from 'livekit-server-sdk';

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
 * Start recording the room. Saves to local file path config OR cloud storage as configured.
 * For simplicity we use built-in EncodedFileOutput pointing to local; in production wire to S3/Cloudinary.
 */
export const startRoomRecording = async (roomName, filepath) => {
  if (!egressClient) return null;
  try {
    const fileOutput = {
      fileType: EncodedFileType.MP4,
      filepath
    };
    return await egressClient.startRoomCompositeEgress(roomName, { file: fileOutput });
  } catch (e) {
    console.error('startRoomRecording error', e?.message);
    return null;
  }
};

export const stopEgress = async (egressId) => {
  if (!egressClient || !egressId) return null;
  try {
    return await egressClient.stopEgress(egressId);
  } catch {
    return null;
  }
};

export default {
  generateLiveKitToken,
  createRoom,
  deleteRoom,
  listParticipants,
  removeParticipant,
  startRoomRecording,
  stopEgress
};
