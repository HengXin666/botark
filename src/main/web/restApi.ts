/**
 * Stable REST API v1 for BotArk.
 *
 * The API is intentionally a thin, documented layer over the same main-process
 * IPC handlers the desktop UI uses. It exposes workspace metadata, Hark
 * accounts/projects/messages and quota endpoints without leaking IPC channels
 * to external clients.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApiKeyIdentity } from '@shared/apiKeys'
import { HARK_CHANNELS } from '@shared/ipc'
import type { MobileWorkspaceSnapshot } from '@shared/mobileSync'
import { parseHarkConversations } from '@shared/harkProjects'

const MAX_BODY_BYTES = 2 * 1024 * 1024
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export interface RestApiOptions {
  version: string
  getSnapshot: () => MobileWorkspaceSnapshot | null
  invokeIpc: (channel: string, args: unknown[]) => Promise<unknown>
  apiToken?: string
  /** Validate a managed bearer key; returns null for unknown/revoked keys. */
  authenticateKey?: (token: string) => ApiKeyIdentity | null
  /** Record one completed API request for key audit/usage. */
  onRequest?: (entry: {
    keyId: string
    method: string
    path: string
    statusCode: number
    durationMs: number
    accountId?: string
    botId?: string
    tokens?: number
  }) => void
  /** Record token usage for a key. */
  onUsage?: (
    keyId: string,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number; estimated?: boolean }
  ) => void
  /** Return false after a key is revoked; open SSE streams are closed. */
  isKeyActive?: (keyId: string) => boolean
  /** Subscribe to live workspace events; return an unsubscribe function. */
  subscribeEvents?: (listener: (event: unknown) => void) => () => void
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

interface HarkRpcResponse {
  ok?: boolean
  data?: unknown
  status?: number
  code?: string
  message?: string
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function tokenFromRequest(req: IncomingMessage): string {
  const auth = req.headers['authorization']
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }
  const apiKey = req.headers['x-api-key']
  return typeof apiKey === 'string' ? apiKey.trim() : ''
}

function readApiToken(explicit?: string): string | undefined {
  const direct = explicit?.trim() || process.env['BOTARK_API_TOKEN']?.trim()
  if (direct) return direct
  const file = process.env['BOTARK_API_TOKEN_FILE']?.trim()
  if (!file || !existsSync(file)) return undefined
  try {
    return readFileSync(file, 'utf8').trim() || undefined
  } catch {
    return undefined
  }
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(JSON.stringify(value))
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { ok: false, error: { code, message } })
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new ApiError(413, 'payload_too_large', '请求体过大')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ApiError(400, 'invalid_json', '请求体不是合法 JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'invalid_json', '请求体必须是 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function parseLimit(raw: string | null): number {
  const value = numberValue(raw)
  if (value === null) return DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)))
}

function parseTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function accountPlatform(account: Record<string, unknown>): string {
  return stringValue(account['platformId'])
}

function accountSummary(account: Record<string, unknown>, activeBotIds: Map<string, string>): Record<string, unknown> {
  const id = stringValue(account['id'])
  return {
    id,
    platformId: accountPlatform(account),
    displayName: stringValue(account['displayName']) || stringValue(account['handle']) || id,
    handle: stringValue(account['handle']),
    status: stringValue(account['status']) || 'offline',
    ...(account['statusDetail'] ? { statusDetail: stringValue(account['statusDetail']) } : {}),
    ...(activeBotIds.has(id) ? { botId: activeBotIds.get(id) } : {})
  }
}

function normalizeHarkMessages(raw: unknown): Array<Record<string, unknown>> {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const rows = Array.isArray(root['messages']) ? root['messages'] : []
  return rows.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const message = item as Record<string, unknown>
    const id = stringValue(message['id'])
    if (!id) return []
    const role = stringValue(message['role']).toLowerCase() === 'user' ? 'user' : 'assistant'
    return [{
      id,
      role,
      text: stringValue(message['content']) || stringValue(message['text']),
      createdAt: parseTime(message['createdAt']),
      ...(Array.isArray(message['toolCalls']) ? { toolCalls: message['toolCalls'] } : {}),
      ...(message['jobStatus'] ? { jobStatus: stringValue(message['jobStatus']) } : {}),
      ...(message['error'] ? { error: stringValue(message['error']) } : {})
    }]
  })
}

function normalizeProject(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    id: stringValue(raw['id']),
    kind: stringValue(raw['kind']) === 'main' ? 'main' : 'project',
    title: stringValue(raw['title']) || null,
    favorite: raw['favorite'] === true,
    archivedAt: stringValue(raw['archivedAt']) || null,
    ...(typeof raw['createdAt'] === 'string' ? { createdAt: raw['createdAt'] } : {}),
    activityAt: stringValue(raw['activityAt']) || stringValue(raw['updatedAt']) || stringValue(raw['createdAt']),
    ...(raw['status'] ? { status: stringValue(raw['status']) } : {})
  }
}

function findTokenUsage(value: unknown, depth = 0): { promptTokens: number; completionTokens: number; totalTokens: number } | null {
  if (!value || typeof value !== 'object' || depth > 4) return null
  const record = value as Record<string, unknown>
  const pick = (names: string[]): number | null => {
    for (const name of names) {
      const n = numberValue(record[name])
      if (n !== null) return n
    }
    return null
  }
  const prompt = pick(['prompt_tokens', 'promptTokens', 'input_tokens', 'inputTokens'])
  const completion = pick(['completion_tokens', 'completionTokens', 'output_tokens', 'outputTokens'])
  const total = pick(['total_tokens', 'totalTokens', 'tokens'])
  if (prompt !== null || completion !== null || total !== null) {
    return {
      promptTokens: prompt ?? 0,
      completionTokens: completion ?? 0,
      totalTokens: total ?? (prompt ?? 0) + (completion ?? 0)
    }
  }
  for (const key of ['usage', 'tokenUsage', 'usageMetadata', 'result', 'data']) {
    if (key in record) {
      const found = findTokenUsage(record[key], depth + 1)
      if (found) return found
    }
  }
  return null
}

export class RestApi {
  private readonly version: string
  private readonly getSnapshot: () => MobileWorkspaceSnapshot | null
  private readonly invokeIpc: (channel: string, args: unknown[]) => Promise<unknown>
  private readonly tokenHash: Buffer | null
  private readonly authenticateKey?: (token: string) => ApiKeyIdentity | null
  private readonly onRequest?: RestApiOptions['onRequest']
  private readonly onUsage?: RestApiOptions['onUsage']
  private readonly isKeyActive?: (keyId: string) => boolean
  private readonly corsOrigin?: string
  private readonly sseClients = new Map<ServerResponse, string>()
  private readonly unsubscribeEvents?: () => void

  dispose(): void {
    this.unsubscribeEvents?.()
    for (const client of this.sseClients.keys()) {
      try {
        client.end()
      } catch {
        /* ignore */
      }
    }
    this.sseClients.clear()
  }

  /** Close every SSE stream belonging to a revoked key immediately. */
  closeKeyStreams(keyId: string): void {
    for (const [client, ownerId] of this.sseClients) {
      if (ownerId !== keyId) continue
      try {
        client.end()
      } catch {
        /* ignore */
      }
      this.sseClients.delete(client)
    }
  }

  constructor(options: RestApiOptions) {
    this.version = options.version
    this.getSnapshot = options.getSnapshot
    this.invokeIpc = options.invokeIpc
    this.authenticateKey = options.authenticateKey
    this.onRequest = options.onRequest
    this.onUsage = options.onUsage
    this.isKeyActive = options.isKeyActive
    this.corsOrigin = process.env['BOTARK_API_CORS_ORIGIN']?.trim() || undefined
    // Managed keys are authoritative; legacy env token is only used by
    // standalone RestApi callers that do not provide a key store.
    const token = options.authenticateKey ? undefined : readApiToken(options.apiToken)
    if (token !== undefined && token.length < 16) {
      throw new Error('[api] BOTARK_API_TOKEN must be at least 16 characters')
    }
    this.tokenHash = token ? sha256(token) : null
    this.unsubscribeEvents = options.subscribeEvents?.((event) => this.broadcastSse(event))
  }

  private broadcastSse(event: unknown): void {
    if (this.sseClients.size === 0) return
    const type =
      event && typeof event === 'object' && typeof (event as Record<string, unknown>)['type'] === 'string'
        ? String((event as Record<string, unknown>)['type'])
        : 'message'
    const payload = 'event: ' + type + '\ndata: ' + JSON.stringify(event) + '\n\n'
    for (const [client, keyId] of this.sseClients) {
      if (this.isKeyActive && !this.isKeyActive(keyId)) {
        try {
          client.end()
        } catch {
          /* ignore */
        }
        this.sseClients.delete(client)
        continue
      }
      try {
        client.write(payload)
      } catch {
        this.sseClients.delete(client)
      }
    }
  }

  private openEvents(req: IncomingMessage, res: ServerResponse, keyId: string): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    res.write('retry: 3000\n\n')
    const snapshot = this.getSnapshot()
    if (snapshot) res.write('event: snapshot\ndata: ' + JSON.stringify({ type: 'snapshot', snapshot }) + '\n\n')
    this.sseClients.set(res, keyId)
    const heartbeat = setInterval(() => {
      if (this.isKeyActive && !this.isKeyActive(keyId)) {
        try {
          res.end()
        } catch {
          /* ignore */
        }
        this.sseClients.delete(res)
        clearInterval(heartbeat)
        return
      }
      try {
        res.write(': keepalive\n\n')
      } catch {
        this.sseClients.delete(res)
      }
    }, 15_000)
    heartbeat.unref?.()
    const cleanup = (): void => {
      clearInterval(heartbeat)
      this.sseClients.delete(res)
    }
    req.on('close', cleanup)
    req.on('error', cleanup)
    res.on('close', cleanup)
  }

  get enabled(): boolean {
    return this.tokenHash !== null || Boolean(this.authenticateKey)
  }

  private authenticate(req: IncomingMessage): ApiKeyIdentity | null {
    const supplied = tokenFromRequest(req)
    if (!supplied) return null
    // In web mode the managed key store is authoritative: a revoked key can
    // never fall back to an environment token.
    if (this.authenticateKey) return this.authenticateKey(supplied)
    if (!this.tokenHash) return null
    const digest = sha256(supplied)
    if (digest.length !== this.tokenHash.length || !timingSafeEqual(digest, this.tokenHash)) return null
    return { id: 'env-bootstrap', name: 'Environment bootstrap token' }
  }

  private snapshot(): MobileWorkspaceSnapshot {
    const snapshot = this.getSnapshot()
    if (!snapshot) throw new ApiError(503, 'workspace_not_synced', '工作区尚未同步，请先打开一次 BotArk Web 管理界面')
    return snapshot
  }

  private findAccount(snapshot: MobileWorkspaceSnapshot, accountId: string): Record<string, unknown> {
    const account = snapshot.accounts[accountId] as unknown as Record<string, unknown> | undefined
    if (!account) throw new ApiError(404, 'account_not_found', '账号不存在')
    return account
  }

  private findBot(snapshot: MobileWorkspaceSnapshot, botId: string): Record<string, unknown> {
    const bot = snapshot.bots.find((item) => item.id === botId) as unknown as Record<string, unknown> | undefined
    if (!bot) throw new ApiError(404, 'bot_not_found', 'Bot 不存在')
    return bot
  }

  private async harkRpc(request: Record<string, unknown>): Promise<unknown> {
    const response = (await this.invokeIpc('bothub:hark:rpc', [request])) as HarkRpcResponse | null
    if (!response || response.ok !== true) {
      const status = typeof response?.status === 'number' && response.status >= 400 ? response.status : 502
      throw new ApiError(status, response?.code || 'platform_error', response?.message || 'Hark 平台请求失败')
    }
    return response.data
  }

  private async sendHarkMessage(
    accountId: string,
    botId: string | null,
    projectId: string | null,
    text: string,
    timezone?: string,
    keyId?: string
  ): Promise<Record<string, unknown>> {
    const snapshot = this.snapshot()
    const account = this.findAccount(snapshot, accountId)
    if (accountPlatform(account) !== 'hark') {
      throw new ApiError(501, 'platform_not_supported', '当前 REST API 发送接口先支持 Hark；其他平台请使用 Web 客户端')
    }
    let targetProject = projectId
    if (!targetProject && botId) {
      const bot = this.findBot(snapshot, botId)
      targetProject = stringValue(bot['activeSessionId']) || null
    }
    if (!targetProject) {
      const main = (await this.harkRpc({
        accountId,
        op: 'mainConversation',
        ...(timezone ? { timezone } : {})
      })) as Record<string, unknown>
      targetProject = stringValue(main['conversationId']) || null
    }
    if (!targetProject) throw new ApiError(502, 'project_not_found', '无法确定 Hark 主会话')
    const data = (await this.harkRpc({
      accountId,
      op: 'sendMessage',
      conversationId: targetProject,
      text,
      ...(timezone ? { timezone } : {})
    })) as Record<string, unknown>
    this.recordTokenUsage(keyId, text, data)
    const responseMessageId = stringValue(data['responseMessageId']) || null
    this.broadcastSse({
      type: 'message',
      botId: botId ?? targetProject,
      message: {
        id: responseMessageId || 'api-sent',
        botId: botId ?? targetProject,
        accountId,
        role: 'user',
        text,
        createdAt: Date.now()
      }
    })
    this.scheduleReplyPoll(accountId, targetProject, botId, responseMessageId, keyId)
    return {
      ok: true,
      accepted: true,
      accountId,
      projectId: targetProject,
      messageId: responseMessageId,
      idempotencyKey: stringValue(data['idempotencyKey']) || null
    }
  }

  private recordTokenUsage(keyId: string | undefined, text: string, result: unknown): void {
    if (!keyId || !this.onUsage) return
    const exact = findTokenUsage(result)
    const estimatedPrompt = Math.max(1, Math.ceil(text.length / 4))
    this.onUsage(keyId, {
      promptTokens: exact?.promptTokens ?? estimatedPrompt,
      completionTokens: exact?.completionTokens ?? 0,
      totalTokens: exact?.totalTokens ?? estimatedPrompt,
      estimated: !exact
    })
  }

  private scheduleReplyPoll(
    accountId: string,
    projectId: string,
    botId: string | null,
    responseMessageId: string | null,
    keyId?: string
  ): void {
    if (!keyId || this.sseClients.size === 0) return
    void (async () => {
      try {
        const data = (await this.harkRpc({
          accountId,
          op: 'pollReply',
          conversationId: projectId,
          ...(botId ? { botId } : {}),
          ...(responseMessageId ? { responseMessageId } : {}),
          timeoutMs: 45_000
        })) as Record<string, unknown>
        const reply = data['reply'] as Record<string, unknown> | null | undefined
        const text = reply ? stringValue(reply['content']) || stringValue(reply['text']) : ''
        if (!reply || !text) return
        const messageId = stringValue(reply['id']) || 'api-reply'
        this.broadcastSse({
          type: 'message',
          botId: botId ?? projectId,
          message: {
            id: messageId,
            botId: botId ?? projectId,
            accountId,
            role: 'bot',
            text,
            createdAt: Date.now()
          }
        })
        const estimated = Math.max(1, Math.ceil(text.length / 4))
        this.onUsage?.(keyId, { promptTokens: 0, completionTokens: estimated, totalTokens: estimated, estimated: true })
      } catch {
        /* polling is best-effort; clients can still poll messages */
      }
    })()
  }

  private async quotaForAccount(accountId: string): Promise<Record<string, unknown>> {
    const account = this.findAccount(this.snapshot(), accountId)
    const platform = accountPlatform(account)
    if (platform === 'hark') {
      const data = await this.harkRpc({ accountId, op: 'call', method: 'GET', path: '/billing/summary' })
      return { accountId, platform, quota: data }
    }
    if (platform === 'meta-muse') {
      try {
        const data = await this.invokeIpc('bothub:muse:quota:refresh', [accountId])
        return { accountId, platform, quota: data }
      } catch (error) {
        throw new ApiError(
          503,
          'quota_requires_web_ui',
          'Muse 额度查询需要先打开 Web UI 并加载该账号：' + (error instanceof Error ? error.message : String(error))
        )
      }
    }
    if (platform === 'dot') {
      const data = await this.invokeIpc('bothub:dot:rpc', [{ accountId, op: 'rateLimits' }])
      return { accountId, platform, quota: data }
    }
    if (platform === 'antigravity') {
      const data = await this.invokeIpc('bothub:antigravity:rpc', [{ accountId, action: 'models' }])
      return { accountId, platform, quota: data }
    }
    throw new ApiError(501, 'quota_not_supported', '该平台没有可查询的额度接口')
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith('/api/v1/')) return false
    const method = (req.method || 'GET').toUpperCase()
    if (this.corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', this.corsOrigin)
      res.setHeader('Vary', 'Origin')
    }
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        ...(this.corsOrigin ? { 'Access-Control-Allow-Origin': this.corsOrigin } : {}),
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-API-Key',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '86400'
      })
      res.end()
      return true
    }
    if (url.pathname === '/api/v1/health') {
      sendJson(res, 200, {
        ok: true,
        app: 'botark',
        api: 'v1',
        version: this.version,
        auth: this.enabled ? 'bearer' : 'disabled'
      })
      return true
    }
    if (!this.enabled) {
      sendError(res, 503, 'api_disabled', 'REST API 未启用，请先在设置中创建 API 密钥')
      return true
    }
    const identity = this.authenticate(req)
    if (!identity) {
      sendError(res, 401, 'unauthorized', 'API 密钥无效或已失效')
      return true
    }
    const startedAt = Date.now()
    let requestRecorded = false
    const recordRequest = (): void => {
      if (requestRecorded) return
      requestRecorded = true
      this.onRequest?.({
        keyId: identity.id,
        method,
        path: url.pathname,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt
      })
    }
    res.once('finish', recordRequest)
    res.once('close', recordRequest)

    try {
      const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
      // parts: ['api', 'v1', ...]
      if (parts[2] === 'events' && parts.length === 3 && method === 'GET') {
        this.openEvents(req, res, identity.id)
        return true
      }

      if (parts[2] === 'workspace' && parts.length === 3 && method === 'GET') {
        sendJson(res, 200, { ok: true, workspace: this.snapshot() })
        return true
      }

      if (parts[2] === 'accounts' && parts[3] === 'imports' && parts.length === 4 && method === 'GET') {
        const accounts = await this.invokeIpc(HARK_CHANNELS.remoteList, [])
        sendJson(res, 200, { ok: true, accounts })
        return true
      }

      if (parts[2] === 'accounts' && parts[3] === 'import' && parts.length === 4 && method === 'POST') {
        const body = await readJsonBody(req)
        const account = await this.invokeIpc(HARK_CHANNELS.remoteImport, [body])
        sendJson(res, 200, { ok: true, account })
        return true
      }

      if (parts[2] === 'accounts' && parts.length === 3 && method === 'GET') {
        const snapshot = this.snapshot()
        const activeBotIds = new Map<string, string>()
        for (const bot of snapshot.bots) {
          if (bot.activeAccountId) activeBotIds.set(bot.activeAccountId, bot.id)
        }
        const accounts = Object.values(snapshot.accounts).map((account) =>
          accountSummary(account as unknown as Record<string, unknown>, activeBotIds)
        )
        // A registration machine may have imported accounts before any Web UI
        // has pushed a workspace snapshot. Surface that registry immediately so
        // REST clients do not have to wait for a browser tab to open.
        try {
          const imported = (await this.invokeIpc(HARK_CHANNELS.remoteList, [])) as Array<Record<string, unknown>>
          if (Array.isArray(imported)) {
            const known = new Set(accounts.map((account) => String(account['id'])))
            for (const row of imported) {
              const id = stringValue(row['accountId'])
              const email = stringValue(row['email'])
              if (!id || known.has(id)) continue
              accounts.push({
                id,
                platformId: 'hark',
                displayName: stringValue(row['displayName']) || email || id,
                handle: email,
                status: 'offline'
              })
            }
          }
        } catch {
          /* remote registry is optional; the snapshot remains authoritative */
        }
        sendJson(res, 200, { ok: true, accounts })
        return true
      }

      if (parts[2] === 'bots' && parts.length === 3 && method === 'GET') {
        sendJson(res, 200, { ok: true, bots: this.snapshot().bots })
        return true
      }

      if (parts[2] === 'bots' && parts[3] && parts.length === 4 && method === 'GET') {
        const snapshot = this.snapshot()
        const bot = this.findBot(snapshot, parts[3])
        sendJson(res, 200, {
          ok: true,
          bot,
          messages: (snapshot.messages[parts[3]] ?? []).slice(-DEFAULT_LIMIT)
        })
        return true
      }

      if (parts[2] === 'bots' && parts[3] && parts[4] === 'messages' && parts.length === 5 && method === 'GET') {
        const snapshot = this.snapshot()
        this.findBot(snapshot, parts[3])
        const limit = parseLimit(url.searchParams.get('limit'))
        sendJson(res, 200, {
          ok: true,
          botId: parts[3],
          messages: (snapshot.messages[parts[3]] ?? []).slice(-limit)
        })
        return true
      }

      if (parts[2] === 'bots' && parts[3] && parts[4] === 'messages' && parts.length === 5 && method === 'POST') {
        const body = await readJsonBody(req)
        const text = stringValue(body['text'])
        if (!text) throw new ApiError(400, 'text_required', 'text 不能为空')
        const bot = this.findBot(this.snapshot(), parts[3])
        const accountId = stringValue(body['accountId']) || stringValue(bot['activeAccountId'])
        if (!accountId) throw new ApiError(400, 'account_required', '缺少 accountId')
        const result = await this.sendHarkMessage(
          accountId,
          parts[3],
          stringValue(body['projectId']) || null,
          text,
          stringValue(body['timezone']) || undefined,
          identity.id
        )
        sendJson(res, 200, { ...result, botId: parts[3] })
        return true
      }

      if (parts[2] === 'accounts' && parts[3] && parts[4] === 'projects' && parts.length === 5 && method === 'GET') {
        const account = this.findAccount(this.snapshot(), parts[3])
        if (accountPlatform(account) !== 'hark') {
          throw new ApiError(501, 'platform_not_supported', '项目接口先支持 Hark')
        }
        const data = await this.harkRpc({ accountId: parts[3], op: 'listConversations' })
        sendJson(res, 200, {
          ok: true,
          accountId: parts[3],
          projects: parseHarkConversations(data).map((project) => normalizeProject(project as unknown as Record<string, unknown>))
        })
        return true
      }

      if (parts[2] === 'accounts' && parts[3] && parts[4] === 'projects' && parts.length === 5 && method === 'POST') {
        const account = this.findAccount(this.snapshot(), parts[3])
        if (accountPlatform(account) !== 'hark') {
          throw new ApiError(501, 'platform_not_supported', '项目接口先支持 Hark')
        }
        const body = await readJsonBody(req)
        const title = stringValue(body['title'])
        const data = (await this.harkRpc({ accountId: parts[3], op: 'createProject', ...(title ? { title } : {}) })) as Record<string, unknown>
        sendJson(res, 200, {
          ok: true,
          accountId: parts[3],
          project: { id: stringValue(data['conversationId']), title: stringValue(data['title']) || null, kind: 'project' }
        })
        return true
      }

      if (parts[2] === 'accounts' && parts[3] && parts[4] === 'projects' && parts[5] && parts[6] === 'messages' && parts.length === 7 && method === 'GET') {
        const account = this.findAccount(this.snapshot(), parts[3])
        if (accountPlatform(account) !== 'hark') {
          throw new ApiError(501, 'platform_not_supported', '项目消息接口先支持 Hark')
        }
        const data = await this.harkRpc({ accountId: parts[3], op: 'conversationMessages', conversationId: parts[5] })
        const messages = normalizeHarkMessages(data)
        const limit = parseLimit(url.searchParams.get('limit'))
        sendJson(res, 200, { ok: true, accountId: parts[3], projectId: parts[5], messages: messages.slice(-limit) })
        return true
      }

      if (parts[2] === 'accounts' && parts[3] && parts[4] === 'projects' && parts[5] && parts[6] === 'messages' && parts.length === 7 && method === 'POST') {
        const body = await readJsonBody(req)
        const text = stringValue(body['text'])
        if (!text) throw new ApiError(400, 'text_required', 'text 不能为空')
        const result = await this.sendHarkMessage(
          parts[3]!,
          null,
          parts[5]!,
          text,
          stringValue(body['timezone']) || undefined,
          identity.id
        )
        sendJson(res, 200, result)
        return true
      }

      if (parts[2] === 'accounts' && parts[3] && parts[4] === 'quota' && parts.length === 5 && method === 'GET') {
        sendJson(res, 200, { ok: true, ...(await this.quotaForAccount(parts[3])) })
        return true
      }

      if (parts[2] === 'quota' && parts.length === 3 && method === 'GET') {
        const snapshot = this.snapshot()
        const accounts = Object.values(snapshot.accounts).map((account) => account.id)
        const quotas = await Promise.all(
          accounts.map(async (accountId) => {
            try {
              return await this.quotaForAccount(accountId)
            } catch (error) {
              return {
                accountId,
                error: { code: error instanceof ApiError ? error.code : 'quota_error', message: error instanceof Error ? error.message : String(error) }
              }
            }
          })
        )
        sendJson(res, 200, { ok: true, quotas })
        return true
      }

      sendError(res, 404, 'not_found', '接口不存在')
      return true
    } catch (error) {
      if (error instanceof ApiError) {
        sendError(res, error.status, error.code, error.message)
        return true
      }
      const message = error instanceof Error ? error.message : String(error)
      sendError(res, 500, 'internal_error', message)
      return true
    }
  }
}
