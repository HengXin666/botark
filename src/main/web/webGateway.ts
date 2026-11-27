/**
 * BotArk Web Gateway.
 *
 * Runs inside the Electron main process when BOTARK_WEB=1. It serves the
 * browser-only renderer build (dist/web) and exposes every registered
 * ipcMain handler over a single WebSocket. The renderer talks to this gateway
 * through src/renderer/src/lib/webBridge.ts, so the existing React UI and the
 * existing main-process platform clients stay unchanged.
 *
 * This is intentionally an IPC pass-through, not a second business layer:
 * every registerXxxIpc() call still registers its normal Electron handler;
 * captureIpcHandlers() only records the same handlers for remote dispatch.
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import {
  clearSessionCookie,
  clientIp,
  isSameOriginRequest,
  isSecureRequest,
  sessionCookie,
  sessionIdFromRequest,
  WebAuth
} from './webAuth'
import { RestApi } from './restApi'
import { getMobileWorkspaceSnapshot, subscribeMobileSyncEvents } from '../mobileSync/mobileSyncIpc'
import { getApiKeyStore } from '../apiKeys/apiKeyIpc'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

export const WEB_GATEWAY_WS_PATH = '/api/web/v1/ws'
const DEFAULT_PORT = 29178
const MAX_BODY_BYTES = 64 * 1024 * 1024

let captured = false
let hostWindow: BrowserWindow | null = null
let httpServer: Server | null = null
let wsServer: WebSocketServer | null = null
let listeningPort = 0
let webAuth: WebAuth | null = null
let restApi: RestApi | null = null
let apiKeyRevokeUnsub: (() => void) | null = null
const sockets = new Set<WebSocket>()
const socketSessionTimers = new WeakMap<WebSocket, ReturnType<typeof setInterval>>()

const invokeHandlers = new Map<string, IpcHandler>()
const eventHandlers = new Map<string, IpcHandler>()

/**
 * Record the handlers that registerXxxIpc() installs. Call this before any
 * registerXxxIpc() call in the web entrypoint.
 */
export function captureIpcHandlers(): void {
  if (captured) return
  captured = true

  const originalHandle = ipcMain.handle.bind(ipcMain)
  ;(ipcMain as any).handle = (channel: string, listener: IpcHandler) => {
    invokeHandlers.set(channel, listener)
    return originalHandle(channel, listener as never)
  }

  const originalOn = ipcMain.on.bind(ipcMain)
  ;(ipcMain as any).on = (channel: string, listener: IpcHandler) => {
    eventHandlers.set(channel, listener)
    return originalOn(channel, listener as never)
  }
}

function fakeEvent(): unknown {
  if (!hostWindow) throw new Error('Web gateway host window is not ready')
  return {
    sender: hostWindow.webContents,
    senderFrame: hostWindow.webContents.mainFrame,
    frameId: 0,
    processId: 0,
    ports: []
  }
}

/** Dispatch one captured ipcMain handler directly; used by the REST API. */
export async function invokeCapturedHandler(channel: string, args: unknown[] = []): Promise<unknown> {
  const handler = invokeHandlers.get(channel)
  if (!handler) throw new Error('No IPC handler registered for ' + channel)
  return await handler(fakeEvent(), ...args)
}

function serializeError(error: unknown): Record<string, unknown> {
  const err = error as { name?: string; message?: string; code?: unknown; status?: unknown }
  return {
    name: err?.name || 'Error',
    message: err?.message || String(error),
    ...(err?.code !== undefined ? { code: err.code } : {}),
    ...(err?.status !== undefined ? { status: err.status } : {})
  }
}

function broadcastEvent(channel: string, args: unknown[]): void {
  if (sockets.size === 0) return
  let payload: string
  try {
    payload = JSON.stringify({ type: 'event', channel, args })
  } catch {
    return
  }
  for (const socket of sockets) {
    if (socket.readyState !== WebSocket.OPEN) continue
    try {
      socket.send(payload)
    } catch {
      /* broken pipe; the close handler removes it */
    }
  }
}

/**
 * Every main-process module emits renderer events through BrowserWindow's
 * webContents.send(). Patch the hidden host window so the same event is also
 * forwarded to every browser client.
 */
function patchHostWindowSend(window: BrowserWindow): void {
  const contents = window.webContents as unknown as {
    send: (channel: string, ...args: unknown[]) => void
    __botarkWebPatched?: boolean
  }
  if (contents.__botarkWebPatched) return
  const original = contents.send.bind(contents)
  const patched = (channel: string, ...args: unknown[]): void => {
    try {
      original(channel, ...args)
    } catch {
      /* the hidden window may be closing */
    }
    broadcastEvent(channel, args)
  }
  try {
    contents.send = patched
  } catch {
    Object.defineProperty(contents, 'send', { configurable: true, value: patched })
  }
  contents.__botarkWebPatched = true
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function sendText(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function mimeTypeFor(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.ico':
      return 'image/x-icon'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    case '.ttf':
      return 'font/ttf'
    case '.map':
      return 'application/json; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

export function resolveWebRoot(): string {
  const envRoot = process.env['BOTARK_WEB_ROOT']?.trim()
  const candidates = [
    envRoot,
    join(process.resourcesPath || '', 'web'),
    join(app.getAppPath(), 'dist', 'web'),
    join(process.cwd(), 'dist', 'web'),
    join(__dirname, '..', '..', 'dist', 'web')
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) return resolve(candidate)
  }
  throw new Error(
    '[web] renderer build not found; run "npm run build:web" first (looked in: ' +
      candidates.join(', ') +
      ')'
  )
}

function isInside(root: string, target: string): boolean {
  const normalizedRoot = resolve(root)
  const normalizedTarget = resolve(target)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + sep)
}

function injectWebFlag(html: string): string {
  if (html.includes('/web-flag.js')) return html
  // Insert before the app module script so the flag exists before React starts.
  return html.replace('<script', '<script src="/web-flag.js"></script>\n    <script')
}

async function serveStatic(res: ServerResponse, pathname: string, root: string): Promise<void> {
  let requested = pathname
  if (requested === '/' || requested === '') requested = '/index.html'

  let filePath = resolve(root, '.' + requested)
  if (!isInside(root, filePath) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    // SPA fallback for client-side routes; missing asset paths stay 404.
    if (extname(requested)) {
      sendText(res, 404, 'Not found', 'text/plain; charset=utf-8')
      return
    }
    filePath = join(root, 'index.html')
  }

  if (!existsSync(filePath)) {
    sendText(res, 404, 'Not found', 'text/plain; charset=utf-8')
    return
  }

  let body = readFileSync(filePath)
  if (filePath.endsWith('index.html')) {
    body = Buffer.from(injectWebFlag(body.toString('utf8')), 'utf8')
  }

  const cacheControl = filePath.includes(sep + 'assets' + sep)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache'
  res.writeHead(200, {
    'Content-Type': mimeTypeFor(filePath),
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  })
  res.end(body)
}

function isAuthorized(req: IncomingMessage): boolean {
  const sessionId = sessionIdFromRequest(req)
  return Boolean(sessionId && webAuth?.validateSession(sessionId))
}

function authRequired(res: ServerResponse): void {
  sendJson(res, 401, { ok: false, code: 'unauthorized', message: '请先登录 BotArk Web' })
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' })
  res.end()
}

function publicOrigin(): string | undefined {
  return process.env['BOTARK_WEB_PUBLIC_ORIGIN']?.trim() || undefined
}

function cookieSecure(req: IncomingMessage): boolean {
  return isSecureRequest(
    req,
    process.env['BOTARK_WEB_COOKIE_SECURE'] === '1',
    webAuth?.trustProxy === true
  )
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid JSON body')
  return parsed as Record<string, unknown>
}

function loginPageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>BotArk · 登录</title>
  <style>
    :root { color-scheme: dark; --bg:#0b1020; --card:#121a30; --line:#263451; --text:#f4f7ff; --muted:#9ba8c4; --accent:#6ea8fe; --danger:#ff8b8b; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px; background:radial-gradient(900px 600px at 15% 0%,#1c3566 0%,var(--bg) 52%,#070b16 100%); color:var(--text); font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
    main { width:min(100%,380px); }
    .brand { display:flex; align-items:center; gap:10px; margin-bottom:22px; font-weight:650; letter-spacing:-.02em; }
    .mark { display:grid; place-items:center; width:36px; height:36px; border:1px solid #3c5b91; border-radius:10px; background:linear-gradient(145deg,#203a6a,#111b31); font-size:16px; }
    .card { padding:26px; border:1px solid var(--line); border-radius:18px; background:linear-gradient(180deg,rgba(24,35,61,.98),rgba(15,23,42,.98)); box-shadow:0 24px 70px rgba(0,0,0,.38); }
    h1 { margin:0 0 8px; font-size:21px; letter-spacing:-.03em; }
    p { margin:0 0 18px; color:var(--muted); font-size:13.5px; line-height:1.55; }
    label { display:block; margin-bottom:7px; font-size:12.5px; color:#c6d2e8; }
    input { width:100%; height:44px; padding:0 12px; border:1px solid #344666; border-radius:10px; background:#0c1425; color:var(--text); font-size:15px; outline:none; }
    input:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(110,168,254,.18); }
    button { width:100%; height:44px; margin-top:14px; border:0; border-radius:10px; background:linear-gradient(135deg,#6ea8fe,#4f7df0); color:#08111f; font-size:14.5px; font-weight:700; cursor:pointer; }
    button:disabled { opacity:.6; cursor:wait; }
    .error { min-height:20px; margin:10px 0 0; color:var(--danger); font-size:12.5px; }
    .foot { margin-top:16px; color:#71809e; font-size:11.5px; text-align:center; }
  </style>
</head>
<body>
  <main>
    <div class="brand"><span class="mark">◈</span><span>BotArk</span></div>
    <section class="card">
      <h1>登录 BotArk Web</h1>
      <p>请输入站点密码。密码只在本次登录时提交，BotArk 不会保存密码。</p>
      <form id="login-form" novalidate>
        <label for="password">站点密码</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required autofocus />
        <button id="submit" type="submit">登录</button>
        <div id="error" class="error" role="alert" aria-live="polite"></div>
      </form>
    </section>
    <div class="foot">BotArk Web · 凭据仅保存在你的服务器</div>
  </main>
  <script>
    (function () {
      var form = document.getElementById('login-form');
      var input = document.getElementById('password');
      var button = document.getElementById('submit');
      var error = document.getElementById('error');
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        if (!input.value) { input.focus(); return; }
        button.disabled = true;
        error.textContent = '';
        try {
          var response = await fetch('/api/web/v1/login', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: input.value })
          });
          if (response.ok) {
            var next = new URLSearchParams(window.location.search).get('next');
            var safeNext = next && next.charAt(0) === '/' && next.charAt(1) !== '/' && next.indexOf(String.fromCharCode(92)) === -1;
            window.location.replace(safeNext ? next : '/');
            return;
          }
          var data = {};
          try { data = await response.json(); } catch (_) {}
          error.textContent = response.status === 429 ? '尝试过于频繁，请稍后再试' : (data.message || '密码错误');
        } catch (_) {
          error.textContent = '网络错误，请重试';
        } finally {
          button.disabled = false;
          input.select();
        }
      });
    })();
  </script>
</body>
</html>`
}

function sendLoginPage(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  })
  res.end(loginPageHtml())
}

async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isSameOriginRequest(req, publicOrigin())) {
    sendJson(res, 403, { ok: false, message: '请求来源无效' })
    return
  }
  const auth = webAuth
  if (!auth) {
    sendJson(res, 503, { ok: false, message: '登录服务尚未就绪' })
    return
  }
  const ip = clientIp(req, auth.trustProxy)
  const retryAfter = auth.retryAfterMs(ip)
  if (retryAfter > 0) {
    res.setHeader('Retry-After', String(Math.ceil(retryAfter / 1000)))
    sendJson(res, 429, { ok: false, message: '尝试过于频繁，请稍后再试' })
    return
  }

  let body: Record<string, unknown>
  try {
    body = await readJsonBody(req, 4096)
  } catch {
    sendJson(res, 400, { ok: false, message: '请求格式无效' })
    return
  }
  const password = body['password']
  if (typeof password !== 'string' || !password) {
    auth.recordFailure(ip)
    sendJson(res, 401, { ok: false, message: '密码错误' })
    return
  }

  // Constant-ish delay makes scripted guessing less useful.
  await new Promise((resolve) => setTimeout(resolve, 250))
  if (!auth.verifyPassword(password)) {
    auth.recordFailure(ip)
    sendJson(res, 401, { ok: false, message: '密码错误' })
    return
  }

  auth.clearFailures(ip)
  const sessionId = auth.issueSession()
  res.setHeader(
    'Set-Cookie',
    sessionCookie(sessionId, Math.floor(auth.sessionTtlMs / 1000), cookieSecure(req))
  )
  sendJson(res, 200, { ok: true })
}

function handleLogout(req: IncomingMessage, res: ServerResponse): void {
  if (!isSameOriginRequest(req, publicOrigin())) {
    sendJson(res, 403, { ok: false, message: '请求来源无效' })
    return
  }
  const sessionId = sessionIdFromRequest(req)
  if (sessionId) webAuth?.revokeSession(sessionId)
  res.setHeader('Set-Cookie', clearSessionCookie(cookieSecure(req)))
  sendJson(res, 200, { ok: true })
}

async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost')

  if (restApi && (await restApi.handle(req, res, url))) return

  if (req.method === 'GET' && url.pathname === '/api/web/v1/health') {
    sendJson(res, 200, {
      ok: true,
      app: 'botark',
      mode: 'web',
      version: app.getVersion(),
      ws: WEB_GATEWAY_WS_PATH,
      port: listeningPort,
      auth: 'password'
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/login') {
    if (isAuthorized(req)) {
      redirect(res, '/')
      return
    }
    sendLoginPage(res)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/web/v1/login') {
    await handleLogin(req, res)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/web/v1/logout') {
    handleLogout(req, res)
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/web/v1/session') {
    if (isAuthorized(req)) {
      sendJson(res, 200, { ok: true, authenticated: true })
    } else {
      authRequired(res)
    }
    return
  }

  if (!isAuthorized(req)) {
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      const accept = String(req.headers.accept || '')
      if (accept.includes('text/html')) {
        const next = url.pathname + url.search
        redirect(res, '/login?next=' + encodeURIComponent(next))
        return
      }
    }
    authRequired(res)
    return
  }

  if (req.method === 'GET' && url.pathname === '/web-flag.js') {
    sendText(
      res,
      200,
      'window.__BOTARK_WEB_GATEWAY__ = true;\n',
      'text/javascript; charset=utf-8'
    )
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, message: 'Method not allowed' })
    return
  }

  const root = resolveWebRoot()
  await serveStatic(res, url.pathname, root)
}

function sendWs(ws: WebSocket, value: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return
  try {
    ws.send(JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

function handleWsMessage(ws: WebSocket, raw: Buffer): void {
  let message: Record<string, unknown>
  try {
    message = JSON.parse(raw.toString()) as Record<string, unknown>
  } catch {
    return
  }
  if (!message || typeof message !== 'object') return

  if (message['type'] === 'send') {
    const channel = String(message['channel'] || '')
    const args = Array.isArray(message['args']) ? message['args'] : []
    const listener = eventHandlers.get(channel)
    if (listener) {
      Promise.resolve(listener(fakeEvent(), ...args)).catch((error) => {
        console.warn('[web] send ' + channel + ' failed', serializeError(error))
      })
    }
    return
  }

  if (message['type'] === 'ping') {
    sendWs(ws, { type: 'pong', ts: Date.now() })
    return
  }

  if (message['type'] === 'notify') {
    const channel = String(message['channel'] || '')
    const listener = eventHandlers.get(channel)
    if (!listener) return
    try {
      listener(fakeEvent(), ...(Array.isArray(message['args']) ? message['args'] : []))
    } catch (error) {
      console.warn('[web] notify ' + channel + ' failed', serializeError(error))
    }
    return
  }

  if (message['type'] !== 'invoke') return
  const id = message['id']
  const channel = String(message['channel'] || '')
  const args = Array.isArray(message['args']) ? message['args'] : []

  const handler = invokeHandlers.get(channel)
  if (!handler) {
    sendWs(ws, {
      type: 'result',
      id: id,
      ok: false,
      error: { name: 'NoHandlerError', message: 'No IPC handler registered for ' + channel }
    })
    return
  }

  Promise.resolve(handler(fakeEvent(), ...args))
    .then((value) => sendWs(ws, { type: 'result', id: id, ok: true, value: value ?? null }))
    .catch((error) => sendWs(ws, { type: 'result', id: id, ok: false, error: serializeError(error) }))
}

function attachUpgrade(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY_BYTES })

  server.on('upgrade', (req, socket, head) => {
    let url: URL
    try {
      url = new URL(req.url || '/', 'http://localhost')
    } catch {
      socket.destroy()
      return
    }
    if (url.pathname !== WEB_GATEWAY_WS_PATH) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }
    if (!isSameOriginRequest(req, publicOrigin()) || !isAuthorized(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    const sessionId = sessionIdFromRequest(req)
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws)
      const timer = sessionId
        ? setInterval(() => {
            if (!webAuth?.validateSession(sessionId)) {
              try {
                sendWs(ws, { type: 'error', code: 'session_expired', message: '登录已过期，请重新登录' })
                ws.close(4401, 'session expired')
              } catch {
                /* ignore */
              }
            }
          }, 60_000)
        : null
      timer?.unref?.()
      if (timer) socketSessionTimers.set(ws, timer)
      sendWs(ws, {
        type: 'hello',
        app: 'botark',
        mode: 'web',
        version: app.getVersion()
      })
      ws.on('message', (raw) =>
        handleWsMessage(ws, Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer))
      )
      ws.on('close', () => {
        const stored = socketSessionTimers.get(ws)
        if (stored) clearInterval(stored)
        socketSessionTimers.delete(ws)
        sockets.delete(ws)
      })
      ws.on('error', () => {
        const stored = socketSessionTimers.get(ws)
        if (stored) clearInterval(stored)
        socketSessionTimers.delete(ws)
        sockets.delete(ws)
      })
    })
  })

  return wss
}

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      const address = server.address()
      resolvePromise(typeof address === 'object' && address ? address.port : port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

export async function startWebGateway(window: BrowserWindow): Promise<number> {
  if (httpServer) return listeningPort
  hostWindow = window
  captureIpcHandlers()
  patchHostWindowSend(window)

  const sessionHours = Number(process.env['BOTARK_WEB_SESSION_HOURS'] || 12)
  const password = process.env['BOTARK_WEB_PASSWORD']
  const passwordFile = process.env['BOTARK_WEB_PASSWORD_FILE']?.trim()
  const passwordHash = process.env['BOTARK_WEB_PASSWORD_HASH']?.trim()
  const auth = new WebAuth({
    password: password && password.length > 0 ? password : undefined,
    passwordFile: passwordFile || undefined,
    passwordHash: passwordHash || undefined,
    sessionTtlMs:
      (Number.isFinite(sessionHours) && sessionHours > 0 ? sessionHours : 12) * 60 * 60 * 1000,
    trustProxy: process.env['BOTARK_WEB_TRUST_PROXY'] === '1'
  })
  webAuth = auth
  const apiKeys = getApiKeyStore()
  restApi = new RestApi({
    version: app.getVersion(),
    getSnapshot: getMobileWorkspaceSnapshot,
    invokeIpc: invokeCapturedHandler,
    authenticateKey: (token) => apiKeys.authenticate(token),
    isKeyActive: (keyId) => keyId === 'env-bootstrap' || apiKeys.isActive(keyId),
    onRequest: (entry) => apiKeys.recordRequest(entry),
    onUsage: (keyId, usage) => apiKeys.recordUsage(keyId, usage),
    subscribeEvents: subscribeMobileSyncEvents
  })
  apiKeyRevokeUnsub = apiKeys.onRevoke((keyId) => restApi?.closeKeyStreams(keyId))

  const server = createServer((req, res) => {
    void handleHttp(req, res).catch((error: unknown) => {
      console.error('[web] request failed', serializeError(error))
      if (!res.headersSent) sendJson(res, 500, { ok: false, message: 'Internal error' })
      else res.end()
    })
  })
  const wss = attachUpgrade(server)

  const host = process.env['BOTARK_WEB_HOST']?.trim() || '127.0.0.1'
  const configuredPort = Number(process.env['BOTARK_WEB_PORT'] || DEFAULT_PORT)
  listeningPort = await listen(
    server,
    host,
    Number.isFinite(configuredPort) ? configuredPort : DEFAULT_PORT
  )
  httpServer = server
  wsServer = wss
  console.log('[web] BotArk web gateway listening on http://' + host + ':' + listeningPort)
  console.log(
    '[web] password login enabled; session TTL=' +
      auth.sessionTtlMs / 3_600_000 +
      'h; trustProxy=' +
      auth.trustProxy
  )
  if (auth.trustProxy && host !== '127.0.0.1' && host !== 'localhost') {
    console.warn('[web] trusting X-Forwarded-For/X-Forwarded-Proto; only expose this port behind your reverse proxy')
  }
  return listeningPort
}

export async function stopWebGateway(): Promise<void> {
  for (const socket of sockets) {
    try {
      socket.close(1001, 'BotArk shutting down')
    } catch {
      /* ignore */
    }
  }
  sockets.clear()
  if (wsServer) {
    wsServer.close()
    wsServer = null
  }
  if (httpServer) {
    const server = httpServer
    httpServer = null
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }
  listeningPort = 0
  webAuth?.revokeAllSessions()
  webAuth = null
  apiKeyRevokeUnsub?.()
  apiKeyRevokeUnsub = null
  restApi?.dispose()
  restApi = null
  hostWindow = null
}

export function currentWebGatewayPort(): number {
  return listeningPort
}
