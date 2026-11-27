# BotArk REST API v1

This is the stable HTTP API for external clients (including the mobile app).
It runs on the same port as the Web UI, behind SafeLine / HTTPS.

Machine-readable OpenAPI 3.0 spec: [openapi.json](openapi.json). Import it into
Postman, Apifox, Insomnia or Swagger UI to generate a client.

## Authentication

All endpoints except `GET /api/v1/health` require a bearer key:

```http
Authorization: Bearer bk_...
```

The admin signs in to the Web UI with the site password, then opens
**设置与账号 → API 密钥与审计**, creates a permanent key, and copies the
full value once. The server stores only a SHA-256 hash; revoking a key in that
page invalidates it immediately, including any open SSE stream.

The key is separate from the browser site password. Treat it as an admin
credential: it can read the whole workspace and send messages through connected
accounts.

If a browser-based client is hosted on another origin, set
`BOTARK_API_CORS_ORIGIN` to that exact origin. Native mobile apps do not need
CORS.

## Base URL

```text
https://your-domain.example.com/api/v1
```

## Workspace and accounts

### `GET /api/v1/health`

Public. Returns API status and version.

```json
{"ok":true,"app":"botark","api":"v1","version":"1.0.0","auth":"bearer"}
```

### `GET /api/v1/workspace`

Returns the workspace snapshot mirrored from the Web UI: groups, bots,
accounts, recent messages and approvals. The snapshot is persisted under
`/data`, so it survives a Web UI being closed or a server restart after the
first sync.

### `POST /api/v1/workspace/metadata`

Admin-only metadata patch used to align a remote BotArk with the local desktop
workspace without copying credentials or messages. It updates sidebar groups,
bot display names and each bot's group assignment; bots are matched by the
active account handle, so the same Hark account can have a different local bot
id on each instance. The patch is persisted under `/data`, so a browser that
opens later applies it automatically.

```json
{
  "groups": [{"id":"grp_pro1","name":"Pro1","collapsed":false}],
  "bots": [{"matchHandle":"me@example.com","name":"HX-CF-D","groupId":"grp_pro1"}],
  "removeEmptyGroups": true
}
```

### `GET /api/v1/events`

Server-Sent Events stream for live updates. Authenticate with the same bearer
key. The stream starts with a `snapshot` event, followed by events such as
`message_delta`, `message`, `typing`, `status` and `approvals`. A keepalive
comment is sent every 15 seconds. Revoking the key closes open streams
immediately.

```bash
curl -N -H "Authorization: Bearer $BOTARK_API_KEY" \
  https://your-domain.example.com/api/v1/events
```

### `GET /api/v1/accounts`

```json
{
  "ok": true,
  "accounts": [
    {
      "id": "acc_hark_xxx",
      "platformId": "hark",
      "displayName": "Work Hark",
      "handle": "me@example.com",
      "status": "online",
      "botId": "bot_acc_hark_xxx"
    }
  ]
}
```

### `POST /api/v1/accounts/import`

Push a freshly registered Hark account from a registration machine. The
session is written into the server-side Chromium partition and remembered as a
remote import; the token is never returned or written to the audit log.

```bash
curl -X POST -H "Authorization: Bearer $BOTARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"new@example.com","sessionToken":"<__Secure-hark.session_token>"}' \
  https://your-domain.example.com/api/v1/accounts/import
```

```json
{"ok":true,"account":{"accountId":"acc_hark_new_example_com","email":"new@example.com","displayName":"new@example.com","importedAt":1790000000000}}
```

### `GET /api/v1/accounts/imports`

Lists accounts pushed through the import endpoint (metadata only, no tokens).
The Web UI materialises a Hark bot for each one on its next load.

### `GET /api/v1/bots`

Returns bots with `activeAccountId`, `activeSessionId`, `activeSessionTitle`,
`activeSessionKind` and Hark project metadata when available.

### `GET /api/v1/bots/:botId`

Returns one bot plus its recent local messages.

### `GET /api/v1/bots/:botId/messages?limit=50`

Recent messages from the synced workspace (default 50, max 200).

## Hark projects and messages

### `GET /api/v1/accounts/:accountId/projects`

Returns the Hark main conversation and projects. The account must be a Hark
account known to the synced workspace.

### `POST /api/v1/accounts/:accountId/projects`

Create a Hark project.

```json
{"title":"Release planning"}
```

### `GET /api/v1/accounts/:accountId/projects/:projectId/messages?limit=50`

Reads the live Hark transcript for that project through the main-process Hark
client. This works without a browser tab being open.

### `POST /api/v1/accounts/:accountId/projects/:projectId/messages`

Send a Hark message to a specific account and project.

```json
{"text":"Give me the project status"}
```

Response:

```json
{
  "ok": true,
  "accepted": true,
  "accountId": "acc_hark_xxx",
  "projectId": "project_123",
  "messageId": "msg_456",
  "idempotencyKey": "..."
}
```

Poll the project messages endpoint to read the reply.

### `POST /api/v1/bots/:botId/messages`

Convenience endpoint for a bot. It uses the bot's active account and active
project/session when `projectId` is omitted.

```json
{"text":"Continue","projectId":"project_123"}
```

## Quota

### `GET /api/v1/accounts/:accountId/quota`

Returns the provider's quota response:

- **Hark**: `/billing/summary` (daily and pool token meters), works headlessly
- **Muse**: `refreshQuota` snapshot; requires an active Web UI session
- **Dot**: `rateLimits` (5-hour and weekly percentages)
- **Antigravity**: model list with `remainingFraction` and reset time
- **Grok / Hermes**: `501 quota_not_supported`

### `GET /api/v1/quota`

Returns quota results for every account in the workspace. Individual platform
errors are returned per account instead of failing the whole request.

## Token usage

Each key records request count and prompt/completion/total token counters.
Hark's send response does not always expose exact usage, so the server falls
back to a conservative text-length estimate and marks it with `≈` in Settings.
Exact usage is used automatically when the platform returns `usage` fields.

## Errors

```json
{"ok":false,"error":{"code":"unauthorized","message":"API 密钥无效或已失效"}}
```

Common codes:

| HTTP | Code | Meaning |
|---|---|---|
| 401 | `unauthorized` | Missing/invalid bearer token |
| 404 | `account_not_found` / `bot_not_found` | Resource does not exist |
| 501 | `platform_not_supported` | Endpoint not implemented for that platform |
| 503 | `workspace_not_synced` | Open the Web UI once so the workspace snapshot exists |
| 503 | `api_disabled` | The managed API-key store is unavailable |
| 503 | `quota_requires_web_ui` | Muse quota needs an active Web UI session |

## Current scope

- REST v1 is Hark-first for project/message operations.
- Workspace, account, bot and quota reads cover all platforms represented in
  the synced workspace.
- Live push is available over SSE at `/api/v1/events`; polling remains
  available as a fallback.
- Multi-account is supported by passing the target `accountId` explicitly.
