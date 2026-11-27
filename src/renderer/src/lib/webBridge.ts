/**
 * Browser bridge for the BotArk Web Gateway.
 *
 * The desktop renderer talks to Electron through window.electron, exposed by
 * the preload script. In a normal browser there is no preload, so this module
 * installs a compatible object that sends the same IPC channel calls over a
 * WebSocket. The rest of the renderer (and every platform adapter) stays
 * unaware of the transport change.
 *
 * Installed only when the page is served by the gateway (or ?web=1 in dev).
 */
import type { BotHubBridge } from '@shared/bridge'
import {
  ANTIGRAVITY_CHANNELS,
  DOT_CHANNELS,
  GROK_CHANNELS,
  HARK_CHANNELS,
  HERMES_CHANNELS,
  MUSE_CHANNELS,
  VAULT_CHANNELS
} from '@shared/ipc'
import { API_KEY_CHANNELS, type ApiKeyAuditEntry, type ApiKeyCreateResult, type ApiKeyView } from '@shared/apiKeys'
import { MOBILE_SYNC_CHANNELS } from '@shared/mobileSync'
import { WORKSPACE_CHANNEL } from '@shared/workspace'
import { WORKSPACE_PORTAL_CHANNEL } from '@shared/workspacePortal'

declare global {
  interface Window {
    __BOTARK_WEB_GATEWAY__?: boolean
  }
}

type Listener = (event: unknown) => void

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let nextRequestId = 1
const pending = new Map<number, PendingRequest>()
const listeners = new Map<string, Set<Listener>>()
const outbox: string[] = []

function gatewayWsUrl(): string {
  const params = new URLSearchParams(window.location.search)

  if (window.__BOTARK_WEB_GATEWAY__) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return protocol + '//' + window.location.host + '/api/web/v1/ws'
  }

  // Dev escape hatch: vite dev server on :5174 + gateway on :8787.
  const explicit = params.get('gateway')
  const base = explicit ? new URL(explicit) : new URL('http://127.0.0.1:8787')
  const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  return protocol + '//' + base.host + '/api/web/v1/ws'
}

let loginRedirecting = false

function redirectToLogin(): void {
  if (loginRedirecting) return
  loginRedirecting = true
  const next = window.location.pathname + window.location.search
  window.location.replace('/login?next=' + encodeURIComponent(next))
}

function probeSession(): void {
  void fetch('/api/web/v1/session', { credentials: 'same-origin', cache: 'no-store' })
    .then((response) => {
      if (response.status === 401) redirectToLogin()
    })
    .catch(() => undefined)
}

/** Clear the server-side web session and return to the login page. */
export async function logoutWebSession(): Promise<void> {
  try {
    await fetch('/api/web/v1/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
  } catch {
    /* still leave the page */
  } finally {
    window.location.replace('/login')
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, 1500)
}

function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return
  }

  let ws: WebSocket
  try {
    ws = new WebSocket(gatewayWsUrl())
  } catch {
    scheduleReconnect()
    return
  }
  socket = ws

  ws.onopen = () => {
    while (outbox.length > 0) {
      const payload = outbox.shift()
      if (payload) ws.send(payload)
    }
  }

  ws.onmessage = (message) => {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(String(message.data)) as Record<string, unknown>
    } catch {
      return
    }
    if (payload['type'] === 'event') {
      const channel = String(payload['channel'] || '')
      const handlers = listeners.get(channel)
      if (!handlers) return
      const args = Array.isArray(payload['args']) ? payload['args'] : []
      const event = args.length <= 1 ? args[0] : args
      for (const handler of handlers) {
        try {
          handler(event)
        } catch (error) {
          console.warn('[web-bridge] event listener failed', error)
        }
      }
      return
    }

    if (payload['type'] === 'error' && payload['code'] === 'session_expired') {
      redirectToLogin()
      return
    }

    if (payload['type'] !== 'result') return
    const id = Number(payload['id'])
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    clearTimeout(request.timer)
    if (payload['ok']) {
      request.resolve(payload['value'])
      return
    }
    const errorPayload = (payload['error'] || {}) as { name?: string; message?: string; code?: unknown; status?: unknown }
    const error = new Error(errorPayload.message || 'Web gateway request failed')
    error.name = errorPayload.name || 'Error'
    if (errorPayload.code !== undefined) (error as Error & { code?: unknown }).code = errorPayload.code
    if (errorPayload.status !== undefined) (error as Error & { status?: unknown }).status = errorPayload.status
    request.reject(error)
  }

  ws.onclose = (event) => {
    if (socket === ws) socket = null
    for (const [id, request] of pending) {
      clearTimeout(request.timer)
      request.reject(new Error('Web gateway disconnected'))
      pending.delete(id)
    }
    if (event.code === 4401) {
      redirectToLogin()
      return
    }
    scheduleReconnect()
    probeSession()
  }

  ws.onerror = () => {
    /* onclose follows and schedules the retry */
  }
}

function send(payload: Record<string, unknown>): void {
  const text = JSON.stringify(payload)
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(text)
    return
  }
  outbox.push(text)
  connect()
}

function invoke(channel: string, args: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Web gateway request timed out: ' + channel))
    }, 60_000)
    pending.set(id, { resolve, reject, timer })
    send({ type: 'invoke', id, channel, args })
  })
}

function emit(channel: string, args: unknown[]): void {
  send({ type: 'send', channel, args })
}

function subscribe(channel: string, listener: Listener): () => void {
  let set = listeners.get(channel)
  if (!set) {
    set = new Set()
    listeners.set(channel, set)
  }
  set.add(listener)
  return () => {
    set?.delete(listener)
  }
}

function namespaceFromChannels(channels: Record<string, string>): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const result: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const [name, channel] of Object.entries(channels)) {
    if (name === 'event') continue
    result[name] = (...args: unknown[]) => invoke(channel, args)
  }
  return result
}

export function installWebBridge(): void {
  if (typeof window === 'undefined' || window.electron || window.BotArkNative) return
  const params = new URLSearchParams(window.location.search)
  if (!window.__BOTARK_WEB_GATEWAY__ && params.get('web') !== '1') return

  const hark = {
    ...namespaceFromChannels(HARK_CHANNELS),
    onEvent: (listener: Listener) => subscribe(HARK_CHANNELS.event, listener),
    // Interactive BrowserWindow login is meaningless on a remote server.
    // The Hark settings panel and AddBotDialog both support cookie import.
    openLogin: async (): Promise<never> => {
      throw new Error('Web 版请使用 Hark Cookie / Session Token 导入登录')
    }
  }

  const bridge = {
    platform: 'web',
    versions: { electron: '', chrome: '', node: '' },
    hark,
    grok: {
      ...namespaceFromChannels(GROK_CHANNELS),
      onEvent: (listener: Listener) => subscribe(GROK_CHANNELS.event, listener)
    },
    dot: {
      ...namespaceFromChannels(DOT_CHANNELS),
      onEvent: (listener: Listener) => subscribe(DOT_CHANNELS.event, listener)
    },
    muse: {
      ...namespaceFromChannels(MUSE_CHANNELS),
      // The server has no desktop browser; open links in the user's browser.
      openHttps: async (url: unknown) => {
        try {
          window.open(String(url), '_blank', 'noopener,noreferrer')
        } catch {
          /* popup blocked */
        }
        return { ok: true as const }
      },
      openExternal: async (url: unknown) => {
        try {
          window.open(String(url), '_blank', 'noopener,noreferrer')
        } catch {
          /* popup blocked */
        }
        return { ok: true as const }
      },
      onEvent: (listener: Listener) => subscribe(MUSE_CHANNELS.event, listener)
    },
    hermes: {
      ...namespaceFromChannels(HERMES_CHANNELS),
      onEvent: (listener: Listener) => subscribe(HERMES_CHANNELS.event, listener)
    },
    antigravity: {
      ...namespaceFromChannels(ANTIGRAVITY_CHANNELS),
      onEvent: (listener: Listener) => subscribe(ANTIGRAVITY_CHANNELS.event, listener)
    },
    vault: namespaceFromChannels(VAULT_CHANNELS),
    workspace: {
      manage: (scope: unknown, request: unknown) => invoke(WORKSPACE_CHANNEL, [scope, request]),
      run: (scope: unknown, tool: unknown, args: unknown, recipient: unknown) =>
        invoke(WORKSPACE_CHANNEL, [scope, { op: 'run', tool, args, recipient }])
    },
    workspacePortal: {
      manage: (request: unknown) => invoke(WORKSPACE_PORTAL_CHANNEL, [request])
    },
    apiKeys: {
      list: () => invoke(API_KEY_CHANNELS.list, []) as Promise<ApiKeyView[]>,
      create: (name: string) => invoke(API_KEY_CHANNELS.create, [name]) as Promise<ApiKeyCreateResult>,
      revoke: (id: string) => invoke(API_KEY_CHANNELS.revoke, [id]) as Promise<ApiKeyView>,
      audit: (id: string, limit?: number) =>
        invoke(API_KEY_CHANNELS.audit, [id, limit]) as Promise<ApiKeyAuditEntry[]>
    },
    mobileSync: {
      getState: () => invoke(MOBILE_SYNC_CHANNELS.getState, []),
      start: () => invoke(MOBILE_SYNC_CHANNELS.start, []),
      stop: () => invoke(MOBILE_SYNC_CHANNELS.stop, []),
      rotatePairing: () => invoke(MOBILE_SYNC_CHANNELS.rotatePairing, []),
      setIncludeDirectCredentials: (enabled: unknown) =>
        invoke(MOBILE_SYNC_CHANNELS.setIncludeDirectCredentials, [enabled]),
      revokeDevice: (deviceId: unknown) => invoke(MOBILE_SYNC_CHANNELS.revokeDevice, [deviceId]),
      pushSnapshot: (snapshot: unknown) => emit(MOBILE_SYNC_CHANNELS.pushSnapshot, [snapshot]),
      pushEvent: (event: unknown) => emit(MOBILE_SYNC_CHANNELS.pushEvent, [event]),
      onStateChanged: (listener: Listener) => subscribe(MOBILE_SYNC_CHANNELS.stateChanged, listener),
      onCommand: (listener: Listener) => subscribe(MOBILE_SYNC_CHANNELS.command, listener)
    }
  } as unknown as BotHubBridge

  window.electron = bridge
  connect()
  window.addEventListener('beforeunload', () => {
    socket?.close()
    socket = null
  })
}
