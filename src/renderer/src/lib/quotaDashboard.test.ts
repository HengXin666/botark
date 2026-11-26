import { describe, expect, it } from 'vitest'
import type { Bot, BotAccount, BotGroup } from '@/types'
import type { QuotaSample } from '@shared/quotaUsage'
import { buildQuotaAccountDimensions, buildQuotaDailySeries, buildQuotaTokenHeatmap, buildQuotaTokenSummary, filterQuotaDimensions } from './quotaDashboard'

const NOW = new Date(2026, 10, 26, 12).getTime()
const DAY = new Date(2026, 10, 26, 0).getTime()

function account(id: string, displayName: string): BotAccount {
  return { id, platformId: 'hark', displayName, handle: displayName, status: 'online' }
}

function sample(accountId: string, metricKey: string, used: number, limit: number, capturedAt = DAY + 60_000): QuotaSample {
  return {
    accountId,
    platformId: 'hark',
    accountName: accountId,
    metricKey,
    metricLabel: metricKey === 'hark-pool' ? '本月额度' : '今日额度',
    unit: 'tokens',
    used,
    limit,
    capturedAt
  }
}

const accounts = {
  a1: account('a1', 'A1'),
  a2: account('a2', 'A2'),
  a3: account('a3', 'A3')
}
const groups: BotGroup[] = [
  { id: 'g1', name: 'Pro1' },
  { id: 'g2', name: 'Pro2' }
]
const bots = [
  { id: 'b1', name: 'B1', groupId: 'g1', platformId: 'hark', accountIds: ['a1'] },
  { id: 'b2', name: 'B2', groupId: 'g1', platformId: 'hark', accountIds: ['a2'] },
  { id: 'b3', name: 'B3', groupId: 'g2', platformId: 'hark', accountIds: ['a3'] }
] as unknown as Bot[]
const samples: QuotaSample[] = [
  sample('a1', 'hark-daily', 100, 1000),
  sample('a2', 'hark-daily', 200, 2000),
  sample('a3', 'hark-daily', 400, 4000),
  sample('a1', 'hark-pool', 300, 5000),
  sample('a2', 'hark-pool', 400, 6000),
  sample('a3', 'hark-pool', 500, 7000)
]

describe('quotaDashboard', () => {
  it('groups daily token spend by channel and bot group', () => {
    const dimensions = buildQuotaAccountDimensions(accounts, bots, groups)
    const series = buildQuotaDailySeries(samples, dimensions, { days: 2, now: NOW })
    const pro1 = series.find((item) => item.label === 'Hark · Pro1')!
    const pro2 = series.find((item) => item.label === 'Hark · Pro2')!
    expect(pro1.points.find((point) => point.dayStart === DAY)?.spent).toBe(300)
    expect(pro1.points.find((point) => point.dayStart === DAY)?.limit).toBe(3000)
    expect(pro2.points.find((point) => point.dayStart === DAY)?.spent).toBe(400)
  })

  it('applies channel and group filters before aggregating', () => {
    const dimensions = buildQuotaAccountDimensions(accounts, bots, groups)
    const filtered = filterQuotaDimensions(dimensions, { channelId: 'hark', groupId: 'g1' })
    const series = buildQuotaDailySeries(samples, dimensions, { days: 2, now: NOW, filter: { channelId: 'hark', groupId: 'g1' } })
    expect(filtered.map((item) => item.accountId)).toEqual(['a1', 'a2'])
    expect(series).toHaveLength(1)
    expect(series[0]?.points.find((point) => point.dayStart === DAY)?.spent).toBe(300)
  })

  it('sums exact monthly quota and exposes token spend in the heatmap', () => {
    const dimensions = buildQuotaAccountDimensions(accounts, bots, groups)
    const summary = buildQuotaTokenSummary(samples, dimensions, accounts)
    expect(summary.monthlyUsed).toBe(1200)
    expect(summary.monthlyLimit).toBe(18000)
    const heatmap = buildQuotaTokenHeatmap(samples, dimensions, { weeks: 1, now: NOW })
    const row = heatmap.rows.find((item) => item.label === 'Hark · Pro1')!
    const cell = row.cells.find((item) => item.dayStart === DAY)!
    expect(cell.spent).toBe(300)
    expect(cell.sharePercent).toBeCloseTo((300 / 11000) * 100, 5)
  })
})
