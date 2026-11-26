import { beforeEach, describe, expect, it } from 'vitest'
import { clearQuotaSamples, loadQuotaSamples, recordQuotaSamples } from './quotaUsageHistory'

const NOW = new Date('2026-11-25T12:00:00+08:00').getTime()

function sample(used: number, capturedAt = NOW) {
  return {
    accountId: 'acc-history',
    platformId: 'hark',
    accountName: 'Hark 秘书',
    metricKey: 'hark-daily',
    metricLabel: '今日额度',
    unit: 'tokens' as const,
    used,
    limit: 100,
    capturedAt
  }
}

describe('quota history storage', () => {
  beforeEach(() => clearQuotaSamples())

  it('records the latest sample per day and clears history', () => {
    recordQuotaSamples([sample(10)], NOW)
    recordQuotaSamples([sample(20)], NOW)
    const loaded = loadQuotaSamples()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.used).toBe(20)
    clearQuotaSamples()
    expect(loadQuotaSamples()).toHaveLength(0)
  })
})
