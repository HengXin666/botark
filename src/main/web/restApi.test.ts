import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MobileWorkspaceSnapshot } from '@shared/mobileSync'
import { HARK_CHANNELS } from '@shared/ipc'
import { RestApi } from './restApi'

const TOKEN = 'test-api-token-1234567890'

const snapshot = {
  version: 1,
  updatedAtMs: Date.now(),
  hostName: 'test',
  selectedBotId: 'bot1',
  groups: [],
  bots: [
    {
      id: 'bot1',
      platformId: 'hark',
      name: 'Hark One',
      groupId: 'g1',
      activeAccountId: 'h1',
      activeSessionId: 'p1',
      activeSessionKind: 'project',
      lastActivityAt: Date.now()
    }
  ],
  accounts: {
    h1: {
      id: 'h1',
      platformId: 'hark',
      displayName: 'Hark One',
      handle: 'one@example.com',
      status: 'online'
    }
  },
  messages: { bot1: [] },
  approvals: {}
} as unknown as MobileWorkspaceSnapshot

const calls: Array<{ channel: string; args: unknown[] }> = []
const appliedMetadata: unknown[] = []
const api = new RestApi({
  version: '1.0.0-test',
  getSnapshot: () => snapshot,
  invokeIpc: async (channel, args) => {
    calls.push({ channel, args })
    const request = args[0] as Record<string, unknown>
    if (channel === 'bothub:hark:rpc' && request.op === 'listConversations') {
      return {
        ok: true,
        data: {
          conversations: [
            { id: 'p1', kind: 'project', title: 'Alpha', favorite: false, archivedAt: null, activityAt: '2026-11-28T00:00:00.000Z' }
          ]
        }
      }
    }
    if (channel === 'bothub:hark:rpc' && request.op === 'conversationMessages') {
      return { ok: true, data: { messages: [{ id: 'm1', role: 'user', content: 'hello', createdAt: '2026-11-28T00:00:00.000Z' }] } }
    }
    if (channel === 'bothub:hark:rpc' && request.op === 'mainConversation') {
      return { ok: true, data: { conversationId: 'p1' } }
    }
    if (channel === 'bothub:hark:rpc' && request.op === 'sendMessage') {
      return { ok: true, data: { responseMessageId: 'm2' } }
    }
    if (channel === 'bothub:hark:rpc' && request.op === 'call') {
      return { ok: true, data: { meters: { harkTokens: { dailyUsed: 10, dailyLimit: 100 } } } }
    }
    if (channel === HARK_CHANNELS.remoteList) {
      return [{ accountId: 'acc_hark_new', email: 'new@example.com', displayName: 'New', importedAt: 1 }]
    }
    if (channel === HARK_CHANNELS.remoteImport) {
      return { accountId: 'acc_hark_new', email: String(request.email), displayName: 'New', importedAt: 2 }
    }
    return { ok: false, status: 404, message: 'not mocked' }
  },
  apiToken: TOKEN,
  applyWorkspaceMetadata: async (payload) => {
    appliedMetadata.push(payload)
    return { ok: true }
  }
})

let server: Server
let base: string

beforeAll(async () => {
  server = createServer((req, res) => {
    void api.handle(req, res, new URL(req.url || '/', 'http://localhost')).then((handled) => {
      if (!handled) {
        res.writeHead(404)
        res.end()
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  base = 'http://127.0.0.1:' + address.port
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function auth(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', ...(init.headers || {}) }
  }
}

async function json(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(base + path, init)
  return { status: response.status, body: await response.json() }
}

describe('rest api v1', () => {
  it('health is public and reports bearer auth', async () => {
    const { status, body } = await json('/api/v1/health')
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, api: 'v1', auth: 'bearer' })
  })

  it('returns 401 without a valid bearer token', async () => {
    const { status, body } = await json('/api/v1/accounts')
    expect(status).toBe(401)
    expect(body.error.code).toBe('unauthorized')
  })

  it('lists accounts and bots from the synced workspace', async () => {
    const accounts = await json('/api/v1/accounts', auth())
    expect(accounts.status).toBe(200)
    expect(accounts.body.accounts[0]).toMatchObject({ id: 'h1', platformId: 'hark', botId: 'bot1' })
    const bots = await json('/api/v1/bots', auth())
    expect(bots.body.bots[0]).toMatchObject({ id: 'bot1', activeAccountId: 'h1' })
  })

  it('imports and lists remote Hark accounts without returning the token', async () => {
    const imported = await json('/api/v1/accounts/import', auth({
      method: 'POST',
      body: JSON.stringify({ email: 'new@example.com', sessionToken: 'secret-token' })
    }))
    expect(imported.status).toBe(200)
    expect(imported.body.account).toMatchObject({ accountId: 'acc_hark_new', email: 'new@example.com' })
    expect(JSON.stringify(imported.body)).not.toContain('secret-token')

    const listed = await json('/api/v1/accounts/imports', auth())
    expect(listed.status).toBe(200)
    expect(listed.body.accounts[0]).toMatchObject({ accountId: 'acc_hark_new' })
  })

  it('applies a workspace metadata patch through the admin REST API', async () => {
    const payload = {
      groups: [{ id: 'grp_pro1', name: 'Pro1' }],
      bots: [{ matchHandle: 'one@example.com', name: 'Hark Pro1', groupId: 'grp_pro1' }]
    }
    const result = await json('/api/v1/workspace/metadata', auth({ method: 'POST', body: JSON.stringify(payload) }))
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true })
    expect(appliedMetadata.at(-1)).toEqual(payload)

    const invalid = await json('/api/v1/workspace/metadata', auth({ method: 'POST', body: JSON.stringify({ groups: [] }) }))
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.code).toBe('invalid_workspace_metadata')
  })

  it('lists Hark projects and project messages', async () => {
    const projects = await json('/api/v1/accounts/h1/projects', auth())
    expect(projects.status).toBe(200)
    expect(projects.body.projects[0]).toMatchObject({ id: 'p1', title: 'Alpha' })
    const messages = await json('/api/v1/accounts/h1/projects/p1/messages', auth())
    expect(messages.body.messages[0]).toMatchObject({ id: 'm1', role: 'user', text: 'hello' })
  })

  it('sends a Hark message through the captured IPC handler', async () => {
    const result = await json('/api/v1/bots/bot1/messages', auth({
      method: 'POST',
      body: JSON.stringify({ text: 'hello from API' })
    }))
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, accepted: true, accountId: 'h1', projectId: 'p1', messageId: 'm2' })
    expect(calls.some((call) => call.channel === 'bothub:hark:rpc' && (call.args[0] as any).op === 'sendMessage')).toBe(true)
  })

  it('returns Hark quota and unsupported platforms cleanly', async () => {
    const quota = await json('/api/v1/accounts/h1/quota', auth())
    expect(quota.status).toBe(200)
    expect(quota.body.quota).toMatchObject({ meters: { harkTokens: { dailyUsed: 10 } } })
  })

  it('streams workspace events over SSE', async () => {
    let emit: (event: unknown) => void = () => undefined
    const sseApi = new RestApi({
      version: '1.0.0-test',
      getSnapshot: () => snapshot,
      invokeIpc: async () => ({ ok: false, status: 500 }),
      apiToken: TOKEN,
      subscribeEvents: (listener) => {
        emit = listener
        return () => undefined
      }
    })
    const sseServer = createServer((req, res) => {
      void sseApi.handle(req, res, new URL(req.url || '/', 'http://localhost')).then((handled) => {
        if (!handled) {
          res.writeHead(404)
          res.end()
        }
      })
    })
    await new Promise<void>((resolve) => sseServer.listen(0, '127.0.0.1', resolve))
    const address = sseServer.address()
    if (!address || typeof address === 'string') throw new Error('no address')
    const controller = new AbortController()
    try {
      const response = await fetch('http://127.0.0.1:' + address.port + '/api/v1/events', {
        headers: { Authorization: 'Bearer ' + TOKEN },
        signal: controller.signal
      })
      expect(response.status).toBe(200)
      const reader = response.body?.getReader()
      if (!reader) throw new Error('no body')
      const first = await reader.read()
      expect(new TextDecoder().decode(first.value)).toContain('event: snapshot')
      emit({ type: 'status', accountId: 'h1', status: 'online' })
      const second = await reader.read()
      expect(new TextDecoder().decode(second.value)).toContain('event: status')
    } finally {
      controller.abort()
      await new Promise<void>((resolve) => sseServer.close(() => resolve()))
    }
  })
})
