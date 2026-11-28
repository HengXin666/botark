/**
 * Mirror the desktop workspace shape to a remote BotArk over its REST API.
 *
 * Accounts come from the Hark gateway export, so the remote instance receives
 * the same sessions this desktop holds. Group names, bot names and group
 * assignments come from the caller and are applied as a metadata patch.
 */
import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fetch } from 'undici'

export interface MirrorGroup { id: string; name: string }
export interface MirrorBot { email: string; name: string; groupId: string }

export interface MirrorRequest {
  url?: unknown
  token?: unknown
  groups?: unknown
  bots?: unknown
}

export interface MirrorResult {
  accounts: number
  imported: number
  failed: number
  groups: number
  bots: number
}

export const GATEWAY_BASE = 'http://127.0.0.1:8920'
const DEFAULT_FILE = 'remote-mirror.json'
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const HTTP_OK = 200
const TIMEOUT_MS = 30000

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseGroups(raw: unknown): MirrorGroup[] {
  if (!Array.isArray(raw)) return []
  const out: MirrorGroup[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const id = text((row as MirrorGroup).id)
    const name = text((row as MirrorGroup).name)
    if (id && name) out.push({ id, name })
  }
  return out
}

function parseBots(raw: unknown): MirrorBot[] {
  if (!Array.isArray(raw)) return []
  const out: MirrorBot[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const email = text((row as MirrorBot).email).toLowerCase()
    const name = text((row as MirrorBot).name)
    const groupId = text((row as MirrorBot).groupId)
    if (email && name && groupId) out.push({ email, name, groupId })
  }
  return out
}

interface Reply { status: number; body: unknown }

async function call(
  base: string,
  path: string,
  init: { method: string; token?: string; body?: unknown }
): Promise<Reply> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': BROWSER_UA
  }
  if (init.token) headers['Authorization'] = 'Bearer ' + init.token
  const response = await fetch(base + path, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  const raw = await response.text()
  let parsed: unknown = raw.slice(0, 300)
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    /* keep the truncated body for the error message */
  }
  return { status: response.status, body: parsed }
}

async function readJson(base: string, token: string, path: string): Promise<unknown> {
  const reply = await call(base, path, { method: 'GET', token })
  if (reply.status === HTTP_OK) return reply.body
  if (reply.status === 503) return {}
  throw new Error(`${path} 返回 ${reply.status}: ${JSON.stringify(reply.body).slice(0, 200)}`)
}

function workspaceOf(doc: unknown): { groups: MirrorGroup[]; handles: Set<string> } {
  const root = ((doc as { workspace?: unknown })?.workspace ?? doc) as {
    groups?: unknown
    accounts?: unknown
  }
  const handles = new Set<string>()
  const accounts = root.accounts
  const rows = Array.isArray(accounts)
    ? accounts
    : Object.values((accounts ?? {}) as Record<string, unknown>)
  for (const row of rows) {
    const value = row as { handle?: unknown; displayName?: unknown }
    const handle = text(value?.handle || value?.displayName).toLowerCase()
    if (handle) handles.add(handle)
  }
  return { groups: parseGroups(root.groups), handles }
}

function remoteGroupIds(local: MirrorGroup[], remote: MirrorGroup[]): Map<string, string> {
  const byName = new Map<string, string>()
  for (const group of remote) {
    const key = group.name.toLowerCase()
    if (!byName.has(key)) byName.set(key, group.id)
  }
  const out = new Map<string, string>()
  for (const group of local) out.set(group.id, byName.get(group.name.toLowerCase()) ?? group.id)
  return out
}

async function poolTokens(): Promise<Map<string, string>> {
  const reply = await call(GATEWAY_BASE, '/api/accounts/export?with_token=1', { method: 'GET' })
  if (reply.status !== HTTP_OK) {
    throw new Error(`Hark 网关导出返回 ${reply.status}，先确认 8920 在运行`)
  }
  const rows = ((reply.body as { accounts?: unknown })?.accounts ?? []) as Array<{
    email?: unknown
    session_token?: unknown
  }>
  const out = new Map<string, string>()
  for (const row of rows) {
    const email = text(row.email).toLowerCase()
    const token = text(row.session_token)
    if (email && token) out.set(email, token)
  }
  return out
}

/** Target instance pre-provisioned on disk so the panel needs no typing. */
export function defaultMirrorSettings(): MirrorRequest {
  const path = join(app.getPath('userData'), DEFAULT_FILE)
  if (!existsSync(path)) return { url: '', token: '' }
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8')) as MirrorRequest
    return { url: text(doc.url), token: text(doc.token) }
  } catch {
    return { url: '', token: '' }
  }
}

/**
 * Import the sessions the VPS is missing, then post one metadata patch.
 * Remote-only accounts keep their own names; nothing is deleted.
 */
export async function mirrorWorkspace(request: MirrorRequest): Promise<MirrorResult> {
  const base = text(request.url).replace(/\/+$/, '')
  const token = text(request.token)
  const groups = parseGroups(request.groups)
  const bots = parseBots(request.bots)
  if (!base || !token) throw new Error('VPS 地址或 API Key 为空')
  if (bots.length === 0) throw new Error('没有可同步的 Hark bot')

  const existing = workspaceOf(await readJson(base, token, '/api/v1/workspace'))
  const imports = (await readJson(base, token, '/api/v1/accounts/imports')) as {
    accounts?: Array<{ email?: unknown }>
  }
  for (const row of imports.accounts ?? []) {
    const email = text(row.email).toLowerCase()
    if (email) existing.handles.add(email)
  }

  const tokens = await poolTokens()
  let imported = 0
  let failed = 0
  for (const bot of bots) {
    if (existing.handles.has(bot.email)) continue
    const sessionToken = tokens.get(bot.email) ?? ''
    if (!sessionToken) {
      failed += 1
      continue
    }
    const reply = await call(base, '/api/v1/accounts/import', {
      method: 'POST',
      token,
      body: { email: bot.email, sessionToken, displayName: bot.email }
    })
    if (reply.status === HTTP_OK && (reply.body as { ok?: unknown })?.ok === true) imported += 1
    else failed += 1
  }

  const mapped = remoteGroupIds(groups, existing.groups)
  const payload = {
    groups: groups.map((group) => ({
      id: mapped.get(group.id) ?? group.id,
      name: group.name,
      collapsed: false
    })),
    bots: bots.map((bot) => ({
      matchHandle: bot.email,
      name: bot.name,
      groupId: mapped.get(bot.groupId) ?? bot.groupId
    }))
  }
  const posted = await call(base, '/api/v1/workspace/metadata', {
    method: 'POST',
    token,
    body: payload
  })
  if (posted.status !== HTTP_OK) {
    throw new Error(`元数据同步返回 ${posted.status}: ${JSON.stringify(posted.body).slice(0, 200)}`)
  }
  return {
    accounts: bots.length,
    imported,
    failed,
    groups: payload.groups.length,
    bots: payload.bots.length
  }
}