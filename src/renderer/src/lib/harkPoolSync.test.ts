import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBotStore } from '@/store/botStore'
import { syncHarkPool } from './harkPoolSync'

const importMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/bridge', () => ({
  getBridge: () => ({ hark: { importCredentials: importMock } })
}))

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

describe('syncHarkPool', () => {
  beforeEach(() => {
    importMock.mockReset()
    importMock.mockResolvedValue({ signedIn: true })
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
    expect(byName.get('Hark · pro2')).toBe('grp_pro2')
    expect(byName.get('Hark · pro1')).toBe('grp_pro1')
    expect(importMock).toHaveBeenCalledTimes(2)
  })
})
