import { describe, expect, it } from 'vitest'
import {
  appendQuotaSamples,
  buildQuotaCalendar,
  buildQuotaHeatmap,
  buildQuotaSeries,
  clampPercent,
  quotaHeatLevels,
  quotaPercent,
  quotaRangeDays,
  type QuotaSample
} from './quotaUsage'

const NOW = new Date('2026-11-25T12:00:00+08:00').getTime()
const DAY = 86_400_000

function sample(overrides: Partial<QuotaSample> = {}): QuotaSample {
  return {
    accountId: 'acc-1',
    platformId: 'hark',
    accountName: 'Hark 秘书',
    metricKey: 'hark-daily',
    metricLabel: '今日额度',
    unit: 'tokens',
    used: 25,
    limit: 100,
    capturedAt: NOW,
    ...overrides
  }
}

describe('quota usage model', () => {
  it('normalizes percent and token samples', () => {
    expect(clampPercent(-1)).toBe(0)
    expect(clampPercent(101)).toBe(100)
    expect(quotaPercent(sample({ used: 3, limit: 4 }))).toBe(75)
    expect(quotaPercent(sample({ unit: 'percent', used: 42 }))).toBe(42)
    expect(quotaPercent(sample({ limit: 0 }))).toBe(0)
  })

  it('keeps only the latest sample per series per day', () => {
    const first = sample({ capturedAt: NOW - 3_600_000, used: 20 })
    const second = sample({ capturedAt: NOW - 600_000, used: 28 })
    const yesterday = sample({ capturedAt: NOW - DAY, used: 10 })
    const merged = appendQuotaSamples([first, yesterday], [second], { now: NOW })
    expect(merged).toHaveLength(2)
    expect(merged.find((item) => item.capturedAt === second.capturedAt)?.used).toBe(28)
    expect(merged.some((item) => item.capturedAt === first.capturedAt)).toBe(false)
  })

  it('prunes samples older than the retention window', () => {
    const old = sample({ capturedAt: NOW - 200 * DAY })
    const recent = sample({ capturedAt: NOW - 2 * DAY })
    expect(appendQuotaSamples([old, recent], [], { now: NOW, maxAgeDays: 90 })).toEqual([recent])
  })

  it('builds one line series per account metric with daily points', () => {
    const samples = [
      sample({ capturedAt: NOW - 2 * DAY, used: 10 }),
      sample({ capturedAt: NOW - DAY, used: 20 }),
      sample({ capturedAt: NOW, used: 35 }),
      sample({ accountId: 'acc-2', accountName: '另一个账号', capturedAt: NOW, used: 50 }),
      sample({ accountId: 'acc-2', accountName: '另一个账号', capturedAt: NOW, used: 55 })
    ]
    const series = buildQuotaSeries(samples, { days: 7, now: NOW })
    expect(series).toHaveLength(2)
    expect(series[0]!.points.map((point) => point.percent)).toEqual([10, 20, 35])
    expect(series[1]!.latest?.percent).toBeCloseTo(55, 6)
  })

  it('builds a full grid with missing days left empty', () => {
    const rows = buildQuotaHeatmap([sample({ capturedAt: NOW - DAY })], { days: 3, now: NOW })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.cells).toHaveLength(3)
    expect(rows[0]!.cells[0]!.percent).toBeNull()
    expect(rows[0]!.cells[1]!.percent).toBe(25)
    expect(rows[0]!.cells[2]!.percent).toBeNull()
  })

  it('returns a stable local-day range', () => {
    const days = quotaRangeDays({ days: 3, now: NOW })
    expect(days).toHaveLength(3)
    expect(days[1]! - days[0]!).toBe(DAY)
  })

  it('builds a Monday-first 53-week calendar with daily maximums', () => {
    const yesterday = new Date(2026, 10, 24, 9).getTime()
    const today = new Date(2026, 10, 25, 10).getTime()
    const calendar = buildQuotaCalendar(
      [
        sample({ capturedAt: yesterday, used: 20, metricKey: 'daily', metricLabel: '今日额度' }),
        sample({ capturedAt: yesterday, used: 80, metricKey: 'weekly', metricLabel: '周额度' }),
        sample({ capturedAt: today, used: 60 })
      ],
      { weeks: 53, now: NOW }
    )
    expect(calendar.days).toHaveLength(53 * 7)
    expect(new Date(calendar.days[0]!.dayStart).getDay()).toBe(1)
    const yesterdayCell = calendar.days.find((day) => day.dayStart === new Date(2026, 10, 24).getTime())
    expect(yesterdayCell?.percent).toBe(80)
    expect(yesterdayCell?.sampleCount).toBe(2)
    expect(yesterdayCell?.topLabel).toContain('周额度')
    const todayCell = calendar.days.find((day) => day.dayStart === new Date(2026, 10, 25).getTime())
    expect(todayCell?.percent).toBe(60)
    expect(calendar.days.find((day) => day.dayStart > new Date(2026, 10, 25).getTime())?.percent).toBeNull()
    expect(calendar.months.length).toBeGreaterThan(0)
  })

  it('grades sparse and dense heatmaps into five levels', () => {
    const sparse = quotaHeatLevels([null, 0, 10, 50, 100])
    expect(sparse[0]).toBe(0)
    expect(sparse[1]).toBe(0)
    expect(sparse[4]).toBe(4)
    expect(sparse[2]).toBeLessThan(sparse[3]!)
    const dense = quotaHeatLevels([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    expect(dense.every((level) => level >= 0 && level <= 4)).toBe(true)
    expect(dense[0]).toBe(0)
    expect(dense[10]).toBe(4)
  })
})
