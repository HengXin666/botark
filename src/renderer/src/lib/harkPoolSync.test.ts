import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBotStore } from '@/store/botStore'
import { syncHarkPool } from './harkPoolSync'

const importMock = vi.hoisted(() => vi.fn())
const rpcMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/bridge', () => ({
  getBridge: () => ({ hark: { importCredentials: importMock, rpc: rpcMock } })
}))

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

describe('syncHarkPool', () => {
  beforeEach(() => {
    importMock.mockReset()
    rpcMock.mockReset()
    importMock.mockResolvedValue({ signedIn: true })
    rpcMock.mockResolvedValue({ ok: false, status: 0, message: 'no live quota' })
    useBotStore.setState({
      groups: [
        { id: 'grp_pro2', name: 'Pro2' },
        { id: 'grp_pro1', name: 'Pro1' }
      ],
      bots: [],
      accounts: {},
      messages: {},
      selectedBotId: null,
      connectAccount: async () => undefined
    })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/accounts/export')) {
        return jsonResponse({
          accounts: [
            { email: 'pro2@example.com', session_token: 't1' },
            { email: 'pro1@example.com', session_token: 't2' }
          ]
        })
      }
      return jsonResponse({
        accounts: [
          { email: 'pro2@example.com', limit: 16_000_000 },
          { email: 'pro1@example.com', limit: 8_000_000 }
        ]
      })
    }))
  })

  it('imports new accounts into Pro2 and Pro1 by quota tier', async () => {
    const result = await syncHarkPool()
    expect(result).toMatchObject({ added: 2, moved: 0, existing: 0, failed: 0 })
    const state = useBotStore.getState()
    expect(state.bots).toHaveLength(2)
    const byName = new Map(state.bots.map((bot) => [bot.name, bot.groupId]))
    expect(byName.get('Hark pro2')).toBe('grp_pro2')
    expect(byName.get('Hark pro1')).toBe('grp_pro1')
    expect(importMock).toHaveBeenCalledTimes(2)
  })
})
describe('syncHarkPool live quota', () => {
  it('moves an existing account to Pro2 when billing reports 16M despite the cached 8M row', async () => {
    importMock.mockResolvedValue({ signedIn: true })
    rpcMock.mockResolvedValue({
      ok: true,
      data: { meters: { harkTokens: { dailyLimit: 16_000_000 } } }
    })
    useBotStore.setState({
      groups: [
        { id: 'grp_pro2', name: 'Pro2' },
        { id: 'grp_pro1', name: 'Pro1' }
      ],
      bots: [
        {
          id: 'bot_existing',
          name: 'existing',
          emoji: '-',
          description: '',
          platformId: 'hark',
          groupId: 'grp_pro1',
          accountIds: ['acc_existing'],
          activeAccountId: 'acc_existing',
          memory: [],
          notes: '',
          createdAt: 1,
          unread: 0
        }
      ],
      accounts: {
        acc_existing: {
          id: 'acc_existing',
          platformId: 'hark',
          displayName: 'quota@example.com',
          handle: 'quota@example.com',
          status: 'online'
        }
      },
      messages: { bot_existing: [] },
      selectedBotId: 'bot_existing',
      connectAccount: async () => undefined
    })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/accounts/export')) {
        return jsonResponse({ accounts: [{ email: 'quota@example.com', session_token: 't1' }] })
      }
      return jsonResponse({ accounts: [{ email: 'quota@example.com', limit: 8_000_000 }] })
    }))
    const result = await syncHarkPool()
    expect(result.moved).toBe(1)
    expect(useBotStore.getState().bots[0]?.groupId).toBe('grp_pro2')
  })
})
describe('syncHarkPool keeps hand made groups', () => {
  const GROUPS = [
    { id: 'grp_work', name: 'Workspace' },
    { id: 'grp_pro1', name: 'Pro1' },
    { id: 'grp_pro2', name: 'Pro2' },
    { id: 'grp_cron', name: '定时任务' },
    { id: 'grp_none', name: '无月额度' }
  ]

  function botIn(groupId: string) {
    return {
      id: 'bot_1',
      name: 'acct',
      emoji: '-',
      description: '',
      platformId: 'hark' as const,
      groupId,
      accountIds: ['acc_1'],
      activeAccountId: 'acc_1',
      memory: [],
      notes: '',
      createdAt: 1,
      unread: 0
    }
  }

  function seed(groupId: string) {
    importMock.mockReset()
    rpcMock.mockReset()
    importMock.mockResolvedValue({ signedIn: true })
    rpcMock.mockResolvedValue({
      ok: true,
      data: { meters: { harkTokens: { dailyLimit: 16_000_000 } } }
    })
    useBotStore.setState({
      groups: GROUPS,
      bots: [botIn(groupId)],
      accounts: {
        acc_1: {
          id: 'acc_1',
          platformId: 'hark',
          displayName: 'acct@example.com',
          handle: 'acct@example.com',
          status: 'online'
        }
      },
      messages: { bot_1: [] },
      selectedBotId: 'bot_1',
      connectAccount: async () => undefined
    })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/accounts/export')) {
        return jsonResponse({ accounts: [{ email: 'acct@example.com', session_token: 't1' }] })
      }
      return jsonResponse({ accounts: [{ email: 'acct@example.com', limit: 8_000_000 }] })
    }))
  }

  it('places a 16M account in Pro2, an 8M account in Pro1 and a free account in 无月额度', async () => {
    importMock.mockReset()
    rpcMock.mockReset()
    importMock.mockResolvedValue({ signedIn: true })
    rpcMock.mockResolvedValue({ ok: false, status: 0, message: 'no live quota' })
    useBotStore.setState({
      groups: [
        { id: 'grp_pro2', name: 'Pro2' },
        { id: 'grp_pro1', name: 'Pro1' }
      ],
      bots: [],
      accounts: {},
      messages: {},
      selectedBotId: null,
      connectAccount: async () => undefined
    })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/accounts/export')) {
        return jsonResponse({
          accounts: [
            { email: 'full@example.com', session_token: 't1' },
            { email: 'half@example.com', session_token: 't2' },
            { email: 'free@example.com', session_token: 't3' }
          ]
        })
      }
      return jsonResponse({
        accounts: [
          { email: 'full@example.com', limit: 16_000_000 },
          { email: 'half@example.com', limit: 8_000_000 },
          { email: 'free@example.com', limit: 75_000 }
        ]
      })
    }))
    const result = await syncHarkPool()
    expect(result.added).toBe(3)
    expect(result.placed_none).toBe(1)
    const state = useBotStore.getState()
    const groupOf = new Map(state.bots.map((bot) => [bot.name, bot.groupId]))
    expect(groupOf.get('Hark full')).toBe('grp_pro2')
    expect(groupOf.get('Hark half')).toBe('grp_pro1')
    const none = state.groups.find((group) => group.name === '无月额度')
    expect(none).toBeDefined()
    expect(groupOf.get('Hark free')).toBe(none?.id)
    expect(state.groups.find((group) => group.name === 'Pro1')?.id).not.toBe(groupOf.get('Hark free'))
  })

  it('moves a bot out of Workspace by its measured tier', async () => {
    seed('grp_work')
    const result = await syncHarkPool()
    expect(result.moved).toBe(1)
    expect(result.kept).toBe(0)
    expect(useBotStore.getState().bots[0]?.groupId).toBe('grp_pro2')
  })

  it('moves a bot between Pro1 and Pro2 by its measured tier', async () => {
    seed('grp_pro1')
    const result = await syncHarkPool()
    expect(result.moved).toBe(1)
    expect(result.kept).toBe(0)
    expect(useBotStore.getState().bots[0]?.groupId).toBe('grp_pro2')
  })

  it('leaves a bot in a hand made group and counts it as kept', async () => {
    seed('grp_cron')
    const result = await syncHarkPool()
    expect(result.moved).toBe(0)
    expect(result.kept).toBe(1)
    expect(useBotStore.getState().bots[0]?.groupId).toBe('grp_cron')
  })

  it('leaves a free tier bot in a hand made group untouched', async () => {
    importMock.mockReset()
    rpcMock.mockReset()
    importMock.mockResolvedValue({ signedIn: true })
    rpcMock.mockResolvedValue({ ok: true, data: { meters: { harkTokens: { dailyLimit: 75_000 } } } })
    useBotStore.setState({
      groups: GROUPS,
      bots: [botIn('grp_cron')],
      accounts: {
        acc_1: {
          id: 'acc_1',
          platformId: 'hark',
          displayName: 'acct@example.com',
          handle: 'acct@example.com',
          status: 'online'
        }
      },
      messages: { bot_1: [] },
      selectedBotId: 'bot_1',
      connectAccount: async () => undefined
    })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/accounts/export')) {
        return jsonResponse({ accounts: [{ email: 'acct@example.com', session_token: 't1' }] })
      }
      return jsonResponse({ accounts: [{ email: 'acct@example.com', limit: 75_000 }] })
    }))
    const result = await syncHarkPool()
    expect(result.moved).toBe(0)
    expect(result.kept).toBe(1)
    expect(useBotStore.getState().bots[0]?.groupId).toBe('grp_cron')
  })

  it('leaves a bot in the no quota group untouched', async () => {
    seed('grp_none')
    const result = await syncHarkPool()
    expect(result.moved).toBe(0)
    expect(result.kept).toBe(1)
    expect(useBotStore.getState().bots[0]?.groupId).toBe('grp_none')
  })
})
