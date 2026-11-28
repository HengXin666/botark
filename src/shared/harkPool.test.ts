import { describe, expect, it } from 'vitest'
import { findHarkAccountId, harkPoolAccountId, harkPoolGroupName, harkTierForLimit, parseHarkPoolAccounts } from './harkPool'

describe('harkPool', () => {
  it('classifies 16M as Pro2, 8M as Pro and 75k as unknown', () => {
    expect(harkTierForLimit(16_000_000)).toBe('pro2')
    expect(harkTierForLimit(8_000_000)).toBe('pro')
    expect(harkTierForLimit(75_000)).toBe('unknown')
    expect(harkTierForLimit(undefined)).toBe('unknown')
    expect(harkPoolGroupName('pro2')).toBe('Pro2')
    expect(harkPoolGroupName('pro')).toBe('Pro1')
    expect(harkPoolGroupName('unknown')).toBe('无月额度')
  })

  it('never sends an unread tier into the 8M group', () => {
    for (const tier of ['unknown'] as const) {
      expect(harkPoolGroupName(tier)).not.toBe('Pro1')
      expect(harkPoolGroupName(tier)).not.toBe('Pro2')
    }
  })

  it('joins export tokens with the live quota snapshot', () => {
    const parsed = parseHarkPoolAccounts(
      { accounts: [
        { email: 'A@One.com', session_token: 't1' },
        { email: 'b@two.com', session_token: 't2' },
        { email: 'missing@token.com' }
      ] },
      { accounts: [
        { email: 'a@one.com', limit: 16_000_000 },
        { email: 'b@two.com', limit: 8_000_000 }
      ] }
    )
    expect(parsed.skipped).toBe(1)
    expect(parsed.accounts).toEqual([
      { email: 'a@one.com', sessionToken: 't1', limit: 16_000_000, tier: 'pro2' },
      { email: 'b@two.com', sessionToken: 't2', limit: 8_000_000, tier: 'pro' }
    ])
  })

  it('tolerates malformed documents', () => {
    expect(parseHarkPoolAccounts(null, null)).toEqual({ accounts: [], skipped: 0 })
  })

  it('builds stable ids and finds an existing handle', () => {
    expect(harkPoolAccountId('User.Name+tag@Example.com')).toBe('acc_hark_user_name_tag_example_com')
    const accounts = {
      acc_1: { id: 'acc_1', platformId: 'hark', displayName: 'x', handle: 'User.Name+tag@example.com', status: 'online' }
    } as never
    expect(findHarkAccountId(accounts, 'user.name+tag@example.com')).toBe('acc_1')
    expect(findHarkAccountId(accounts, 'other@example.com')).toBeUndefined()
  })
})
