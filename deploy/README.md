# Deploy EJ Pathway backend + LiveKit on one VPS (Ubuntu 24.04)

Runs everything in Docker, isolated from anything else on the box:

- **backend** — this Express API (fresh), published on host port **5055**
- **livekit** — SFU media server (all call/video media flows through it)
- **egress** — records each call/video into the shared `recordings` volume
- **redis** — LiveKit ↔ Egress coordination

MongoDB stays on Atlas (remote). Uploads and call/video recordings go to
**Cloudflare R2** / S3-compatible object storage.

`nginx` (already on the VPS) terminates TLS for two free **DuckDNS** subdomains:

| Subdomain (example)            | proxied to            | purpose                  |
|--------------------------------|-----------------------|--------------------------|
| `ejpathwayapi.duckdns.org`     | `127.0.0.1:5055`      | API + Socket.IO + webhook|
| `ejpathwaylk.duckdns.org`      | `127.0.0.1:7880`      | LiveKit signaling (wss)  |

> No coturn needed — LiveKit is an SFU with built-in TURN. Media uses UDP 50000–60000 direct to the VPS IP.

---

## 1. Free HTTPS domain (DuckDNS)

1. Sign in at https://www.duckdns.org with GitHub/Google.
2. Create two subdomains, set the **current ip** of both to your VPS IP (`187.77.10.158`):
   - `ejpathwayapi`
   - `ejpathwaylk`

## 2. Firewall

```bash
ufw allow 22,80,443/tcp
ufw allow 7880,7881/tcp
ufw allow 50000:60000/udp
ufw enable && ufw status
```
> Do **not** expose 5055 — nginx reaches it on localhost.

## 3. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

## 4. Get the code + configure

```bash
mkdir -p /var/www/ej-pathway && cd /var/www/ej-pathway
# git clone <your repo>  (or scp the Ej-backend folder here)
cd Ej-backend

# generate LiveKit credentials (keep both):
openssl rand -hex 16   # -> API_KEY
openssl rand -hex 32   # -> API_SECRET
```

Edit **`.env`**:
```
PORT=5001
CLIENT_URL=https://ejpathwayapi.duckdns.org
SERVER_URL=https://ejpathwayapi.duckdns.org
LIVEKIT_URL=wss://ejpathwaylk.duckdns.org
LIVEKIT_API_KEY=<API_KEY>
LIVEKIT_API_SECRET=<API_SECRET>
R2_ACCESS_KEY_ID=<R2_ACCESS_KEY_ID>
R2_SECRET_ACCESS_KEY=<R2_SECRET_ACCESS_KEY>
R2_BUCKET=<R2_BUCKET>
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_REGION=auto
R2_FORCE_PATH_STYLE=true
R2_PUBLIC_BASE_URL=https://<public-r2-domain>
EGRESS_OUTPUT_DIR=/recordings
# EGRESS_S3_* can stay empty; egress reuses R2_* above.
```

Edit **`deploy/livekit.yaml`** — set `keys:` to `<API_KEY>: <API_SECRET>` and
`webhook.urls` to `https://ejpathwayapi.duckdns.org/api/v1/webhooks/livekit`.

Edit **`deploy/egress.yaml`** — set `api_key`/`api_secret` to the same pair.

## 5. Start the stack

```bash
cd deploy
docker compose up -d --build
docker compose ps
docker compose logs -f livekit egress backend
```
Backend is now on `127.0.0.1:5055`, LiveKit ws on `127.0.0.1:7880`.

## 6. nginx + TLS for the two subdomains

Create `/etc/nginx/sites-available/ej-api`:
```nginx
server {
  listen 80;
  server_name ejpathwayapi.duckdns.org;
  client_max_body_size 50M;
  location / {
    proxy_pass http://127.0.0.1:5055;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;        # Socket.IO
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 600s;
  }
}
```

Create `/etc/nginx/sites-available/ej-livekit`:
```nginx
server {
  listen 80;
  server_name ejpathwaylk.duckdns.org;
  location / {
    proxy_pass http://127.0.0.1:7880;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;        # LiveKit signaling ws
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 600s;
  }
}
```

Enable + issue certificates:
```bash
ln -s /etc/nginx/sites-available/ej-api /etc/nginx/sites-enabled/
ln -s /etc/nginx/sites-available/ej-livekit /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

apt install -y certbot python3-certbot-nginx
certbot --nginx -d ejpathwayapi.duckdns.org -d ejpathwaylk.duckdns.org
```

## 7. Verify

```bash
curl https://ejpathwayapi.duckdns.org/api/v1/health     # {"success":true,...}
```
- Start a video session in the app, join from the advisor dashboard → two-way audio/video.
- End it → `egress_ended` webhook fires → admin **Session Recordings** shows the file.

## 8. Point the apps at the VPS

- **Flutter** `lib/core/constants/api_endpoints.dart`:
  `baseUrl = 'https://ejpathwayapi.duckdns.org/api/v1'`
- **Advisor dashboard** `.env.local`: `NEXT_PUBLIC_API_BASE_URL=https://ejpathwayapi.duckdns.org/api/v1`
- **Admin dashboard** `.env.local`: same `NEXT_PUBLIC_API_BASE_URL`

(The apps get the LiveKit URL from the backend's token endpoint, so no LiveKit URL is hardcoded in the apps.)

## Updating later

```bash
cd /var/www/ej-pathway/Ej-backend && git pull
cd deploy && docker compose up -d --build backend
```

### Troubleshooting
- **wss fails on mobile:** cert not issued for `ejpathwaylk` — re-run certbot; confirm DuckDNS IP is correct.
- **One-way / no media:** UDP 50000–60000 blocked, or set `rtc.use_external_ip` to the literal IP in `livekit.yaml`.
- **Recording never appears:** `webhook.urls` unreachable, or `EGRESS_OUTPUT_DIR` ≠ the egress mount (`/recordings`).
- **Cloudinary fails on long videos:** switch to S3 via `EGRESS_S3_*`.
