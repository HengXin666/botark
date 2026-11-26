import { describe, expect, it } from 'vitest'
import type { MuseQuotaSnapshot } from '@shared/ipc'
import { samplesFromDotRateLimits, samplesFromHarkSummary, samplesFromMuseSnapshot } from './quotaUsageSources'

const NOW = new Date('2026-11-25T12:00:00+08:00').getTime()

describe('quota source parsers', () => {
  it('turns a Muse metered subscription into a percentage sample', () => {
    const snapshot = {
      fetchedAt: NOW,
      stale: false,
      success: true,
      subscription: {
        tier: { tierId: 'free', name: 'Muse Free', tierCode: 'FREE', isPaid: false, rank: 0 },
        usage: { state: 'METERED', percentUsed: 17, resetsAt: null, quotaStatus: 'SUFFICIENT' },
        statusSubtitle: null,
        usageRowLabel: 'Free plan',
        usageRowValueLabel: '17% used',
        usageRowFooter: null,
        billingSubtitle: null,
        topupBalance: 80,
        topupTotal: 100,
        topupRowLabel: 'Additional tokens',
        topupRowValueLabel: null,
        topupEligible: true,
        entryPointCtaLabel: null,
        managementActions: { primaryCta: null, managementRows: [] },
        complimentaryRedeemPage: null,
        agreement: null
      }
    } as unknown as MuseQuotaSnapshot
    const samples = samplesFromMuseSnapshot('acc-muse', 'Muse 账号', snapshot, NOW)
    expect(samples.map((item) => item.metricKey)).toEqual(['muse-subscription', 'muse-topup'])
    expect(samples[0]!.used).toBe(17)
    expect(samples[0]!.limit).toBe(100)
    expect(samples[1]!.used).toBe(20)
    expect(samples[1]!.limit).toBe(100)
  })

  it('reads Hark daily and pool token meters', () => {
    const samples = samplesFromHarkSummary(
      'acc-hark',
      'Hark 秘书',
      {
        meters: {
          harkTokens: {
            dailyUsed: 1200,
            dailyLimit: 5000,
            dailyResetsAt: '2026-11-26T00:00:00Z',
            poolUsed: 30000,
            poolLimit: 100000,
            poolResetsAt: '2026-12-04T12:06:30Z'
          }
        }
      },
      NOW
    )
    expect(samples).toHaveLength(2)
    expect(samples[0]).toMatchObject({ metricKey: 'hark-daily', used: 1200, limit: 5000, unit: 'tokens', metricLabel: '今日额度' })
    expect(samples[0]!.periodEnd).toBe(Date.parse('2026-11-26T00:00:00Z'))
    expect(samples[1]).toMatchObject({ metricKey: 'hark-pool', used: 30000, limit: 100000, metricLabel: '本月额度' })
    expect(samples[1]!.periodEnd).toBe(Date.parse('2026-12-04T12:06:30Z'))
  })

  it('reads Dot primary and secondary rate limits', () => {
    const samples = samplesFromDotRateLimits(
      'acc-dot',
      'Dot',
      { rateLimits: { primary: { usedPercent: 12 }, secondary: { usedPercent: 44 } } },
      NOW
    )
    expect(samples.map((item) => item.metricKey)).toEqual(['dot-primary', 'dot-secondary'])
    expect(samples[0]!.used).toBe(12)
    expect(samples[1]!.used).toBe(44)
  })

  it('returns no samples for missing provider data', () => {
    expect(samplesFromMuseSnapshot('x', 'x', null, NOW)).toEqual([])
    expect(samplesFromHarkSummary('x', 'x', {}, NOW)).toEqual([])
    expect(samplesFromDotRateLimits('x', 'x', {}, NOW)).toEqual([])
  })
})
