/**
 * Gateway fleet endpoints for the one-click Pro2 expansion panel.
 */
import { ipcMain } from 'electron'
import { fetch } from 'undici'
import { HARK_CHANNELS } from '@shared/ipc'
import {
  parseFleetPlan,
  parseFleetRunReply,
  parseFleetStatus,
  fleetPlanQuery,
  type FleetPlanRequest,
  type FleetRunRequest,
  type FleetPlan,
  type FleetRunReply,
  type FleetStatus,
  type FleetPullRequest
} from '@shared/fleet'
import { GATEWAY_BASE, defaultMirrorSettings } from './remoteMirror'
import { pullWorkspace } from './remoteWorkspacePull'

const PLAN_TIMEOUT_MS = 90000
const RUN_TIMEOUT_MS = 60000
const STATUS_TIMEOUT_MS = 30000
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const BODY_SLICE = 600

interface GatewayReply {
  status: number
  body: unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberOrZero(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0
}

function bodyText(body: unknown): string {
  if (typeof body === 'string') return body.slice(0, BODY_SLICE)
  try {
    return JSON.stringify(body).slice(0, BODY_SLICE)
  } catch {
    return String(body).slice(0, BODY_SLICE)
  }
}

async function gatewayCall(
  path: string,
  init: { method: string; body?: unknown; timeoutMs: number }
): Promise<GatewayReply> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': BROWSER_UA
  }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  let response: Response
  try {
    response = await fetch(GATEWAY_BASE + path, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs)
    })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    throw new Error('Hark 网关 ' + init.method + ' ' + path + ' 失败: ' + reason)
  }
  const raw = await response.text()
  let parsed: unknown = raw.slice(0, BODY_SLICE)
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    /* keep the truncated body so the panel shows the upstream text */
  }
  return { status: response.status, body: parsed }
}

/** Read the gateway plan without touching an unready endpoint beyond one call. */
export async function fetchFleetPlan(request: FleetPlanRequest): Promise<FleetPlan> {
  const query = fleetPlanQuery(request)
  const reply = await gatewayCall('/api/fleet/plan?' + query, {
    method: 'GET',
    timeoutMs: PLAN_TIMEOUT_MS
  })
  return parseFleetPlan(reply.body, reply.status)
}

/** Build the gateway run body, dropping fields the caller left empty. */
export function fleetRunBody(request: FleetRunRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    target_pro2: numberOrZero(request.target_pro2),
    fuel_per_inviter: numberOrZero(request.fuel_per_inviter),
    prefix: text(request.prefix) || 'hkfz',
    delay: numberOrZero(request.delay),
    dry_run: request.dry_run === true
  }
  if (typeof request.inviter_count === 'number' && Number.isFinite(request.inviter_count)) {
    body.inviter_count = Math.max(0, Math.trunc(request.inviter_count))
  }
  if (typeof request.register_count === 'number' && Number.isFinite(request.register_count)) {
    body.register_count = Math.max(0, Math.trunc(request.register_count))
  }
  const domains = (request.domains ?? []).map((item) => text(item)).filter(Boolean)
  if (domains.length > 0) body.domains = domains
  if (typeof request.max_attempts === 'number' && request.max_attempts > 0) {
    body.max_attempts = Math.trunc(request.max_attempts)
  }
  return body
}

/** Start one gateway fleet job and return its opening stage list. */
export async function startFleetRun(request: FleetRunRequest): Promise<FleetRunReply> {
  const reply = await gatewayCall('/api/fleet/run', {
    method: 'POST',
    body: fleetRunBody(request),
    timeoutMs: RUN_TIMEOUT_MS
  })
  if (reply.status === 404) {
    throw new Error('Hark 网关没有 /api/fleet/run (HTTP 404): ' + bodyText(reply.body))
  }
  return parseFleetRunReply(reply.body, reply.status)
}

/** Read the progress of the most recent gateway fleet job. */
export async function fetchFleetStatus(): Promise<FleetStatus> {
  const reply = await gatewayCall('/api/fleet/status', {
    method: 'GET',
    timeoutMs: STATUS_TIMEOUT_MS
  })
  return parseFleetStatus(reply.body, reply.status)
}

/** Pull the VPS workspace snapshot used for the two-sided diff. */
export async function pullRemoteWorkspace(
  request: FleetPullRequest
): Promise<Awaited<ReturnType<typeof pullWorkspace>>> {
  const fallback = defaultMirrorSettings()
  const url = text(request?.url) || text(fallback.url)
  const token = text(request?.token) || text(fallback.token)
  return pullWorkspace({ url, token })
}

/** Register the fleet and workspace-pull handlers on the hark channel group. */
export function registerHarkFleetIpc(): void {
  ipcMain.handle(HARK_CHANNELS.fleetPlan, async (_event, request: unknown) => {
    const req = (request ?? {}) as FleetPlanRequest
    if (typeof req !== 'object' || req === null) {
      throw new TypeError('Invalid fleet plan request')
    }
    return fetchFleetPlan(req)
  })

  ipcMain.handle(HARK_CHANNELS.fleetRun, async (_event, request: unknown) => {
    if (typeof request !== 'object' || request === null) {
      throw new TypeError('Invalid fleet run request')
    }
    return startFleetRun(request as FleetRunRequest)
  })

  ipcMain.handle(HARK_CHANNELS.fleetStatus, async () => fetchFleetStatus())

  ipcMain.handle(HARK_CHANNELS.mirrorPull, async (_event, request: unknown) => {
    const req = (request ?? {}) as FleetPullRequest
    if (typeof req !== 'object' || req === null) {
      throw new TypeError('Invalid workspace pull request')
    }
    return pullRemoteWorkspace(req)
  })
}
