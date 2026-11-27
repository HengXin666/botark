# BotArk Web (VPS, Hark-first)

This is the browser deployment of BotArk. The React UI is the same bundle as the desktop app; the existing Electron main process runs headless under Xvfb and serves the UI plus a WebSocket IPC bridge.

## What is intentionally omitted

- Phone QR pairing / mobileSync server: not started in web mode. The snapshot bridge is registered only to feed the REST API.
- Auto-updater: not started in web mode.
- Interactive platform login windows: use credential import instead. Hark is the primary supported platform; paste a Hark Session Cookie / Token in Settings.

## Password login

The Web Gateway **requires a site password**. The browser posts it once, the server verifies a scrypt digest, and the browser gets an opaque HttpOnly session cookie (12 hours by default). The password is never written to localStorage and never appears in a URL.

Required environment variables (one of):

| Variable | Purpose |
| --- | --- |
| `BOTARK_WEB_PASSWORD` | Plain password; easiest for Docker Compose. Minimum 8 characters, 12+ recommended. |
| `BOTARK_WEB_PASSWORD_HASH` | Preferred production mode: a scrypt hash. Generate with the `web:hash-password` npm script. |
| `BOTARK_WEB_PASSWORD_FILE` | Read the password from a file, e.g. a Docker secret. |

Generate a hash without putting the password in shell history:

```bash
printf '%s' 'your long password' | npm run web:hash-password
```

In `deploy/.env`, wrap the hash in single quotes (`BOTARK_WEB_PASSWORD_HASH='scrypt$...'`) so Docker Compose does not expand the `$` separators.

Other auth variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOTARK_WEB_SESSION_HOURS` | `12` | Session lifetime in hours. A container restart clears all sessions. |
| `BOTARK_WEB_TRUST_PROXY` | `0` | Set to `1` behind SafeLine/Nginx/Caddy so X-Forwarded-For is used for login throttling and X-Forwarded-Proto for Secure cookies. |
| `BOTARK_WEB_COOKIE_SECURE` | `0` | Set to `1` when users access the site over HTTPS. |
| `BOTARK_WEB_PUBLIC_ORIGIN` | empty | Optional public origin (e.g. `https://botark.example.com`) for Origin checks if the proxy rewrites Host. |
| `BOTARK_API_CORS_ORIGIN` | empty | Optional exact origin allowed by the REST API for browser clients; native mobile apps do not need it. |

Login protection includes scrypt password hashing, timing-safe verification, opaque server-side sessions, HttpOnly/SameSite=Strict cookies, origin checks on login/logout/WebSocket, and per-IP throttling (5 failures / 15 min by default). The web health endpoint is public; every other web route and the WebSocket require a session. REST `/api/v1` routes use the separate managed API keys described below.

## Docker Compose (recommended)

```bash
cp deploy/.env.example deploy/.env
# edit deploy/.env: at minimum BOTARK_WEB_PASSWORD and BOTARK_WEB_COOKIE_SECURE
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
# open http://127.0.0.1:29178 locally, or https://your-domain via SafeLine
```

The Compose service binds only `127.0.0.1:29178`; keep it that way and let SafeLine terminate TLS and forward to it.

## REST API for mobile / external clients

The same gateway exposes a stable REST API under `/api/v1`. Admin users create
and revoke permanent API keys in **设置与账号 → API 密钥与审计**; keys are not
configured through `.env`. See [API.md](API.md) for endpoints and examples;
the machine-readable OpenAPI spec is [openapi.json](openapi.json).

The API can read the workspace snapshot after the Web UI has opened once; Hark
project/message operations call the main-process Hark client directly and can
work after that without a browser tab being open. Hark quota works headlessly;
Muse quota needs an active Web UI session because its session manager is
renderer-bound, while Dot and Antigravity use their main-process readers.
Grok/Hermes return `quota_not_supported`.

## SafeLine (雷池) reverse proxy

Create a site in SafeLine:

- Upstream: `http://127.0.0.1:29178`
  - If SafeLine itself runs in Docker, attach it to the same Docker network as `botark` and use `http://botark:29178` instead of loopback.
- TLS: enable HTTPS for your domain
- Keep the original Host header
- Forward X-Forwarded-For, X-Forwarded-Proto and X-Real-IP

Set in `deploy/.env`:

```env
BOTARK_WEB_TRUST_PROXY=1
BOTARK_WEB_COOKIE_SECURE=1
# Only if SafeLine rewrites Host:
# BOTARK_WEB_PUBLIC_ORIGIN=https://botark.example.com
```

SafeLine WAF/rate-limit rules add a useful outer layer, but the application still enforces its own password throttle.

## Local run (Linux with a display or Xvfb)

```bash
npm ci
npm run build:webapp
BOTARK_WEB_PASSWORD="change-this-long-password" \
  BOTARK_WEB_COOKIE_SECURE=0 \
  xvfb-run -a npm run start:web
# open http://127.0.0.1:29178
```

For HTTPS locally, set BOTARK_WEB_COOKIE_SECURE=1 only after putting TLS in front of the gateway; otherwise the browser will not send the session cookie.

## Manual Docker run

```bash
docker build -f deploy/Dockerfile -t botark-web .
docker run -d --name botark-web \
  -p 127.0.0.1:29178:29178 \
  -e BOTARK_WEB_PASSWORD="change-this-long-password" \
  -e BOTARK_WEB_TRUST_PROXY=1 \
  -e BOTARK_WEB_COOKIE_SECURE=0 \
  -v botark-data:/data \
  botark-web
```

For production, prefer BOTARK_WEB_PASSWORD_HASH or a file-based secret over passing the plaintext password on the command line.

## Hark flow

1. Open **Settings & Accounts → Hark 账号管理**.
2. Paste a Hark `__Secure-hark.session_token` Cookie (or Session Token) into **导入 Hark Session Cookie / Token** and click **导入并新建 Hark Bot**.
3. The server keeps the Hark session in its Chromium partition and proxies the Hark REST/SSE traffic; chat, project status, files and approvals use the existing Hark adapter.

## Security checklist

1. Never expose port 29178 directly to the public internet; publish only through SafeLine/Tailscale.
2. Use BOTARK_WEB_COOKIE_SECURE=1 with HTTPS.
3. Keep `/data` on an encrypted volume and back it up; it contains platform session cookies and account stores.
4. Treat the web UI as a full remote control: the gateway exposes the same high-privilege IPC surface as the desktop app (including workspace tools).
5. Treat generated API keys as admin credentials. Create one per client in Settings, keep it out of URLs/logs, and revoke it immediately if leaked.
6. Rotate the password and restart the container to invalidate all existing sessions.
