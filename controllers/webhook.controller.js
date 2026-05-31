import { receiveWebhookEvent } from '../config/livekit.js';
import { resolveRecordingUrl } from '../services/recording.service.js';
import Session from '../models/session.model.js';

/**
 * Resolve which session an egress event belongs to.
 * We store `egressId` on the session at start time, and rooms are named `session_<id>`.
 */
const findSessionForEgress = async (egressInfo) => {
  if (!egressInfo) return null;
  if (egressInfo.egressId) {
    const byEgress = await Session.findOne({ egressId: egressInfo.egressId });
    if (byEgress) return byEgress;
  }
  const room = egressInfo.roomName || '';
  if (room.startsWith('session_')) {
    const id = room.replace('session_', '');
    const byId = await Session.findById(id).catch(() => null);
    if (byId) return byId;
  }
  if (egressInfo.roomName) {
    return Session.findOne({ livekitRoom: egressInfo.roomName });
  }
  return null;
};

/**
 * LiveKit webhook receiver.
 * Configure LiveKit (livekit.yaml) to POST events here:
 *   webhook:
 *     api_key: <LIVEKIT_API_KEY>
 *     urls:
 *       - https://your-backend/api/v1/webhooks/livekit
 *
 * Mounted with a raw body parser so the signature can be verified.
 */
export const livekitWebhook = async (req, res) => {
  try {
    const event = await receiveWebhookEvent(req.body, req.get('Authorization'));
    if (!event) return res.status(200).json({ ok: true, skipped: true });

    if (event.event === 'egress_ended' || event.event === 'egress_updated') {
      const info = event.egressInfo;
      // EGRESS_COMPLETE === 3 in the LiveKit enum; also accept the string form.
      const status = info?.status;
      const isComplete = status === 3 || status === 'EGRESS_COMPLETE';

      if (info && (event.event === 'egress_ended' || isComplete)) {
        const session = await findSessionForEgress(info);
        if (session) {
          // S3 -> use reported location; local -> upload to Cloudinary (or serve locally).
          const url = await resolveRecordingUrl(info);
          if (url) {
            session.recordingUrl = url;
            await session.save();
          }
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('livekitWebhook error', e?.message);
    // Always 200 so LiveKit does not endlessly retry on our parsing bugs.
    return res.status(200).json({ ok: false });
  }
};

export default { livekitWebhook };
