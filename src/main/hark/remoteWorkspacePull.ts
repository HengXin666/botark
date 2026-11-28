/**
 * Pull the remote BotArk workspace so the panel can diff it against local rows.
 */
import type { RemoteWorkspaceSnapshot } from '@shared/fleet'

interface RemoteReply {
  status: number
  body: unknown
}

interface RemotePointer {
  url?: string
  token?: string
}

const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const HTTP_OK = 200
const TIMEOUT_MS = 30000
const BODY_SLICE = 300

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function readJson(base: string, token: string, path: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': BROWSER_UA,
    Authorization: 'Bearer ' + token
  }
  let response: Response
  try {
    response = await fetch(base + path, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    throw new Error('VPS ' + path + ' 请求失败: ' + reason)
  }
  const raw = await response.text()
  let parsed: unknown = raw.slice(0, BODY_SLICE)
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    /* keep the truncated body for the error message */
  }
  const reply: RemoteReply = { status: response.status, body: parsed }
  if (reply.status === HTTP_OK) return reply.body
  throw new Error(
    'VPS ' + path + ' 返回 ' + reply.status + ': ' + JSON.stringify(reply.body).slice(0, BODY_SLICE)
  )
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function rows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>)
  return []
}

function handleOf(row: Record<string, unknown>): string {
  return text(row.handle || row.displayName || row.email).toLowerCase()
}

function accountsOf(doc: unknown): { handles: string[]; bots: RemoteWorkspaceSnapshot['bots'] } {
  const root = record(record(doc).workspace ?? doc)
  const accounts = rows(root.accounts)
  const byId = new Map<string, string>()
  for (const item of accounts) {
    const row = record(item)
    const id = text(row.id)
    const handle = handleOf(row)
    if (id && handle) byId.set(id, handle)
  }
  const bots: RemoteWorkspaceSnapshot['bots'] = []
  for (const item of rows(root.bots)) {
    const row = record(item)
    const handle = byId.get(text(row.activeAccountId)) ?? ''
    if (!handle) continue
    bots.push({ handle, name: text(row.name), groupId: text(row.groupId) })
  }
  return { handles: [...byId.values()], bots }
}

/** Fetch groups, accounts, imports and bot names from the remote BotArk. */
export async function pullWorkspace(pointer: RemotePointer): Promise<RemoteWorkspaceSnapshot> {
  const base = text(pointer.url).replace(/\/+$/, '')
  const token = text(pointer.token)
  if (!base || !token) throw new Error('VPS 地址或 API Key 为空')

  const workspace = await readJson(base, token, '/api/v1/workspace')
  const imports = await readJson(base, token, '/api/v1/accounts/imports')
  const root = record(record(workspace).workspace ?? workspace)
  const groups: RemoteWorkspaceSnapshot['groups'] = []
  for (const item of rows(root.groups)) {
    const row = record(item)
    const id = text(row.id)
    const name = text(row.name)
    if (id && name) groups.push({ id, name })
  }
  const parsed = accountsOf(workspace)
  const importHandles: string[] = []
  for (const item of rows(record(imports).accounts)) {
    const handle = handleOf(record(item))
    if (handle) importHandles.push(handle)
  }
  return { groups, accounts: parsed.handles, imports: importHandles, bots: parsed.bots }
}
