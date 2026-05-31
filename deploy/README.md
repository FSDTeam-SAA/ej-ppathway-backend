# Self-hosted LiveKit + Recording — VPS setup

This folder runs the calling/video backend on your own VPS:

- **livekit** — the media server (SFU). All call/video audio & video flow through it.
- **egress** — records each call/video session to `./data/recordings`.
- **redis** — coordination between LiveKit and Egress.

Recordings are then pushed to **Cloudinary** (default) or **S3** by the Node backend,
and surfaced in the admin dashboard under **Session Recordings**.

> Note: With LiveKit (an SFU), clients connect to this server — not peer-to-peer —
> so you do **not** need a separate coturn server. LiveKit has built-in TURN
> (enable it in `livekit.yaml` once you have a domain + TLS for very strict networks).

---

## 1. Prerequisites

- A VPS with Docker + Docker Compose.
- Open these ports in the firewall / security group:
  - `7880/tcp` (signaling — front with HTTPS in production)
  - `7881/tcp` (RTC TCP fallback)
  - `50000-60000/udp` (RTC media)
- A LiveKit API key/secret pair. Generate a secret of at least 32 chars:
  ```bash
  openssl rand -hex 32
  ```

## 2. Configure

Edit these three files and use the **same** key/secret in all of them:

| Setting            | livekit.yaml      | egress.yaml | backend `.env`        |
|--------------------|-------------------|-------------|-----------------------|
| API key            | `keys:` (name)    | `api_key`   | `LIVEKIT_API_KEY`     |
| API secret         | `keys:` (value)   | `api_secret`| `LIVEKIT_API_SECRET`  |
| Server URL         | —                 | `ws_url`    | `LIVEKIT_URL`         |

In `livekit.yaml`, set `webhook.urls` to your **public** backend URL:
```
https://your-backend-domain/api/v1/webhooks/livekit
```

In the backend `.env`:
```
LIVEKIT_URL=wss://your-livekit-domain      # or ws://VPS_IP:7880 while testing
LIVEKIT_API_KEY=REPLACE_API_KEY
LIVEKIT_API_SECRET=REPLACE_API_SECRET
```

## 3. Choose recording storage (pick ONE; backend auto-detects)

### Option A — Cloudinary (default; reuses your existing Cloudinary)
Egress writes the file locally, then the backend uploads it to Cloudinary and deletes the temp.
Requires the backend to share the `./data/recordings` volume with egress — run the backend on
this VPS (uncomment the `backend` service in `docker-compose.yml`) or bind-mount the same host dir.

```
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
EGRESS_OUTPUT_DIR=/recordings        # must match the egress volume mount
# leave EGRESS_S3_* unset
```
> Cloudinary video file-size/length limits depend on your plan — long video calls may exceed
> the free tier (100 MB). Use S3 (Option B) for unlimited/large recordings.

### Option B — S3 / MinIO / R2 / Wasabi (egress uploads directly)
```
EGRESS_S3_ACCESS_KEY=...
EGRESS_S3_SECRET=...
EGRESS_S3_BUCKET=ej-recordings
EGRESS_S3_REGION=us-east-1
EGRESS_S3_ENDPOINT=https://your-s3-endpoint   # omit for AWS S3
EGRESS_S3_FORCE_PATH_STYLE=true               # true for MinIO/R2
RECORDING_PUBLIC_BASE_URL=https://cdn.yourdomain.com   # public base for playback (optional)
```
When `EGRESS_S3_*` is set, the backend skips Cloudinary entirely.

## 4. Run

```bash
cp .env.example .env   # in the backend root, then fill values
docker compose up -d
docker compose logs -f livekit egress
```

## 5. Verify

1. Start a video session from the Flutter app and join from the advisor dashboard — you should see/hear each other.
2. End the session. Within a few seconds the `egress_ended` webhook fires.
3. Open the admin dashboard → **Session Recordings** — the recording should appear and play.

### Troubleshooting
- **No video / one-way media:** UDP `50000-60000` likely blocked, or `rtc.use_external_ip`
  didn't detect the public IP — set it to your VPS IP explicitly.
- **Recording never appears:** check `webhook.urls` is reachable from the VPS and that the
  backend log shows the webhook hit; confirm `EGRESS_OUTPUT_DIR` matches the volume mount.
- **Cloudinary upload fails for long calls:** switch to S3 (Option B).
