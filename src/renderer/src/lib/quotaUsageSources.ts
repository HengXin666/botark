import type { MuseQuotaSnapshot } from '@shared/ipc'
import type { QuotaSample } from '@shared/quotaUsage'

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function timestampValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function base(accountId: string, platformId: string, accountName: string, capturedAt: number) {
  return { accountId, platformId, accountName, capturedAt }
}

/** Muse exposes one subscription percentage; top-up balance is optional. */
export function samplesFromMuseSnapshot(
  accountId: string,
  accountName: string,
  snapshot: MuseQuotaSnapshot | null | undefined,
  capturedAt = Date.now()
): QuotaSample[] {
  const subscription = snapshot?.subscription
  if (!subscription) return []
  const samples: QuotaSample[] = []
  if (subscription.usage.state === 'METERED') {
    samples.push({
      ...base(accountId, 'meta-muse', accountName, capturedAt),
      metricKey: 'muse-subscription',
      metricLabel: '周期额度',
      windowLabel: subscription.tier.name,
      unit: 'percent',
      used: subscription.usage.percentUsed,
      limit: 100
    })
  }
  if (
    typeof subscription.topupBalance === 'number' &&
    typeof subscription.topupTotal === 'number' &&
    subscription.topupTotal > 0
  ) {
    samples.push({
      ...base(accountId, 'meta-muse', accountName, capturedAt),
      metricKey: 'muse-topup',
      metricLabel: '额外额度',
      windowLabel: subscription.topupRowLabel ?? undefined,
      unit: 'tokens',
      used: Math.max(0, subscription.topupTotal - subscription.topupBalance),
      limit: subscription.topupTotal
    })
  }
  return samples
}

/** Hark billing summary: daily and rolling-pool token meters. */
export function samplesFromHarkSummary(
  accountId: string,
  accountName: string,
  raw: unknown,
  capturedAt = Date.now()
): QuotaSample[] {
  const root = asObject(raw)
  if (!root) return []
  const meters = asObject(root['meters']) ?? root
  const tokens = asObject(meters['harkTokens']) ?? asObject(root['harkTokens']) ?? meters
  const dailyUsed = numberValue(tokens['dailyUsed'])
  const dailyLimit = numberValue(tokens['dailyLimit'])
  const poolUsed = numberValue(tokens['poolUsed'])
  const poolLimit = numberValue(tokens['poolLimit'])
  const dailyResetsAt = timestampValue(tokens['dailyResetsAt'])
  const poolResetsAt = timestampValue(tokens['poolResetsAt'])
  const samples: QuotaSample[] = []
  if (dailyUsed !== null && dailyLimit !== null && dailyLimit > 0) {
    samples.push({
      ...base(accountId, 'hark', accountName, capturedAt),
      metricKey: 'hark-daily',
      metricLabel: '今日额度',
      windowLabel: 'Hark 每日',
      unit: 'tokens',
      used: dailyUsed,
      limit: dailyLimit,
      ...(dailyResetsAt ? { periodEnd: dailyResetsAt } : {})
    })
  }
  if (poolUsed !== null && poolLimit !== null && poolLimit > 0) {
    samples.push({
      ...base(accountId, 'hark', accountName, capturedAt),
      metricKey: 'hark-pool',
      metricLabel: '本月额度',
      windowLabel: 'Hark 月度',
      unit: 'tokens',
      used: poolUsed,
      limit: poolLimit,
      ...(poolResetsAt ? { periodEnd: poolResetsAt } : {})
    })
  }
  return samples
}

/** Dot/ChatGPT rate limits: 5-hour primary and weekly secondary windows. */
export function samplesFromDotRateLimits(
  accountId: string,
  accountName: string,
  raw: unknown,
  capturedAt = Date.now()
): QuotaSample[] {
  const root = asObject(raw)
  if (!root) return []
  const limits = asObject(root['rateLimits']) ?? root
  const primary = asObject(limits['primary'])
  const secondary = asObject(limits['secondary'])
  const samples: QuotaSample[] = []
  const primaryUsed = numberValue(primary?.['usedPercent'])
  const secondaryUsed = numberValue(secondary?.['usedPercent'])
  if (primaryUsed !== null) {
    samples.push({
      ...base(accountId, 'dot', accountName, capturedAt),
      metricKey: 'dot-primary',
      metricLabel: '5 小时额度',
      windowLabel: 'Dot',
      unit: 'percent',
      used: primaryUsed,
      limit: 100
    })
  }
  if (secondaryUsed !== null) {
    samples.push({
      ...base(accountId, 'dot', accountName, capturedAt),
      metricKey: 'dot-secondary',
      metricLabel: '周度额度',
      windowLabel: 'Dot',
      unit: 'percent',
      used: secondaryUsed,
      limit: 100
    })
  }
  return samples
}
