import type { Bot, BotAccount, BotGroup } from '@/types'
import type { QuotaSample } from '@shared/quotaUsage'
import { buildQuotaCalendar, QUOTA_COLORS, quotaDayStart, quotaHeatLevels, quotaRangeDays, type QuotaCalendar } from '@shared/quotaUsage'

export const QUOTA_CHANNEL_LABELS: Record<string, string> = {
  hark: 'Hark',
  grok: 'Grok Bot',
  'meta-muse': 'Meta Muse',
  dot: 'Dot',
  hermes: 'Hermes',
  antigravity: 'Antigravity'
}

export interface QuotaAccountDimension {
  accountId: string
  channelId: string
  channelLabel: string
  groupId: string
  groupName: string
}

export interface QuotaDashboardFilter {
  channelId: string
  groupId: string
}

export interface QuotaDailyPoint {
  dayStart: number
  /** Token spend on this local day, summed across accounts. */
  spent: number | null
  /** Daily allowance denominator, summed across accounts. */
  limit: number
  sampleCount: number
}

export interface QuotaDailySeries {
  key: string
  channelId: string
  channelLabel: string
  groupId: string
  groupName: string
  label: string
  unit: 'tokens'
  color: string
  points: QuotaDailyPoint[]
  latest: QuotaDailyPoint | null
}

export interface QuotaTokenCell {
  dayStart: number
  spent: number | null
  limit: number
  /** Percentage of the row's monthly quota spent that day. */
  sharePercent: number | null
  sampleCount: number
}

export interface QuotaTokenHeatmapRow {
  key: string
  label: string
  color: string
  monthlyLimit: number
  cells: QuotaTokenCell[]
  levels: number[]
}

export interface QuotaTokenHeatmap {
  calendar: QuotaCalendar
  rows: QuotaTokenHeatmapRow[]
}

export interface QuotaTokenSummary {
  accounts: number
  connected: number
  dailyUsed: number
  dailyLimit: number
  monthlyUsed: number
  monthlyLimit: number
  monthlyResetsAt: number | null
}

/** Map accounts to the channel/group that owns them (account -> bot -> group). */
export function buildQuotaAccountDimensions(
  accounts: Record<string, BotAccount>,
  bots: Bot[],
  groups: BotGroup[]
): QuotaAccountDimension[] {
  const groupNames = new Map(groups.map((group) => [group.id, group.name]))
  const ownerByAccount = new Map<string, Bot>()
  for (const bot of bots) {
    for (const accountId of bot.accountIds) ownerByAccount.set(accountId, bot)
  }
  return Object.values(accounts)
    .map((account) => {
      const owner = ownerByAccount.get(account.id)
      const groupId = owner?.groupId ?? 'ungrouped'
      return {
        accountId: account.id,
        channelId: account.platformId,
        channelLabel: QUOTA_CHANNEL_LABELS[account.platformId] ?? account.platformId,
        groupId,
        groupName: groupNames.get(groupId) ?? '未分组'
      }
    })
    .sort((left, right) => left.channelLabel.localeCompare(right.channelLabel, 'zh-CN') || left.groupName.localeCompare(right.groupName, 'zh-CN'))
}

export function filterQuotaDimensions(
  dimensions: QuotaAccountDimension[],
  filter: QuotaDashboardFilter
): QuotaAccountDimension[] {
  return dimensions.filter(
    (item) =>
      (filter.channelId === 'all' || item.channelId === filter.channelId) &&
      (filter.groupId === 'all' || item.groupId === filter.groupId)
  )
}

export function quotaFilterOptions(dimensions: QuotaAccountDimension[]): {
  channels: Array<{ id: string; label: string; count: number }>
  groups: Array<{ id: string; label: string; count: number }>
} {
  const channels = new Map<string, { id: string; label: string; count: number }>()
  const groups = new Map<string, { id: string; label: string; count: number }>()
  for (const item of dimensions) {
    const channel = channels.get(item.channelId) ?? { id: item.channelId, label: item.channelLabel, count: 0 }
    channel.count += 1
    channels.set(item.channelId, channel)
    const group = groups.get(item.groupId) ?? { id: item.groupId, label: item.groupName, count: 0 }
    group.count += 1
    groups.set(item.groupId, group)
  }
  return {
    channels: [...channels.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN')),
    groups: [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'))
  }
}

function latestSamplesByAccountMetric(samples: QuotaSample[]): Map<string, QuotaSample> {
  const latest = new Map<string, QuotaSample>()
  for (const sample of samples) {
    const key = sample.accountId + '\u0000' + sample.metricKey
    const previous = latest.get(key)
    if (!previous || sample.capturedAt >= previous.capturedAt) latest.set(key, sample)
  }
  return latest
}

/** Sum latest daily and monthly token meters for the selected accounts. */
export function buildQuotaTokenSummary(
  samples: QuotaSample[],
  dimensions: QuotaAccountDimension[],
  accounts: Record<string, BotAccount>
): QuotaTokenSummary {
  const latest = latestSamplesByAccountMetric(samples)
  let dailyUsed = 0
  let dailyLimit = 0
  let monthlyUsed = 0
  let monthlyLimit = 0
  let monthlyResetsAt: number | null = null
  let connected = 0
  for (const dimension of dimensions) {
    const account = accounts[dimension.accountId]
    if (account && (account.status === 'online' || account.status === 'busy')) connected += 1
    const daily = latest.get(dimension.accountId + '\u0000hark-daily')
    const monthly = latest.get(dimension.accountId + '\u0000hark-pool')
    if (daily) {
      dailyUsed += daily.used
      dailyLimit += daily.limit
    }
    if (monthly) {
      monthlyUsed += monthly.used
      monthlyLimit += monthly.limit
      const reset = (monthly as QuotaSample & { periodEnd?: number }).periodEnd
      if (typeof reset === 'number' && Number.isFinite(reset)) monthlyResetsAt = Math.max(monthlyResetsAt ?? 0, reset)
    }
  }
  return { accounts: dimensions.length, connected, dailyUsed, dailyLimit, monthlyUsed, monthlyLimit, monthlyResetsAt }
}

/**
 * Aggregate token spend by channel + group. Hark's daily meter resets each
 * day, so its dailyUsed is already the day's spend; for other cumulative
 * token meters we keep the latest sample per day and let the caller treat it
 * as period usage rather than double-counting Hark's daily+pool meters.
 */
export function buildQuotaDailySeries(
  samples: QuotaSample[],
  dimensions: QuotaAccountDimension[],
  options: { days?: number; now?: number; filter?: QuotaDashboardFilter; dayStarts?: number[] } = {}
): QuotaDailySeries[] {
  const now = options.now ?? Date.now()
  const days = Math.max(1, Math.min(400, Math.round(options.days ?? 14)))
  const dayStarts = options.dayStarts ?? quotaRangeDays({ days, now })
  const allowed = new Set(
    filterQuotaDimensions(dimensions, options.filter ?? { channelId: 'all', groupId: 'all' }).map((item) => item.accountId)
  )
  const dimensionByAccount = new Map(dimensions.map((item) => [item.accountId, item]))
  const bySeries = new Map<string, Map<string, QuotaSample>>()

  for (const sample of samples) {
    if (!allowed.has(sample.accountId) || sample.unit !== 'tokens') continue
    // Hark pool is a period cumulative meter; the daily meter is the spend
    // series. Keeping both would count the same tokens twice.
    if (sample.metricKey === 'hark-pool') continue
    if (sample.capturedAt < dayStarts[0]! || sample.capturedAt > now + 60_000) continue
    const dimension = dimensionByAccount.get(sample.accountId)
    if (!dimension) continue
    const seriesKey = dimension.channelId + '\u0000' + dimension.groupId
    const dayKey = sample.accountId + '\u0000' + sample.metricKey + '\u0000' + quotaDayStart(sample.capturedAt)
    const bucket = bySeries.get(seriesKey) ?? new Map<string, QuotaSample>()
    const previous = bucket.get(dayKey)
    if (!previous || sample.capturedAt >= previous.capturedAt) bucket.set(dayKey, sample)
    bySeries.set(seriesKey, bucket)
  }

  const groupOrder = [...new Set(dimensions.map((item) => item.groupId + '\u0000' + item.groupName))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  return [...bySeries.entries()]
    .sort(([left], [right]) => {
      const leftDim = dimensions.find((d) => d.channelId + '\u0000' + d.groupId === left)!
      const rightDim = dimensions.find((d) => d.channelId + '\u0000' + d.groupId === right)!
      return leftDim.channelLabel.localeCompare(rightDim.channelLabel, 'zh-CN') || groupOrder.indexOf(leftDim.groupId + '\u0000' + leftDim.groupName) - groupOrder.indexOf(rightDim.groupId + '\u0000' + rightDim.groupName)
    })
    .map(([seriesKey, bucket], index) => {
      const [channelId, groupId] = seriesKey.split('\u0000') as [string, string]
      const dimension = dimensions.find((d) => d.channelId === channelId && d.groupId === groupId)!
      const points: QuotaDailyPoint[] = dayStarts.map((dayStart) => {
        let spent = 0
        let limit = 0
        let sampleCount = 0
        for (const [key, sample] of bucket) {
          if (!key.endsWith('\u0000' + dayStart) && !key.endsWith('\u0000' + String(dayStart))) continue
          spent += sample.used
          limit += sample.limit
          sampleCount += 1
        }
        return { dayStart, spent: sampleCount > 0 ? spent : null, limit, sampleCount }
      })
      const latest = [...points].reverse().find((point) => point.spent !== null) ?? null
      return {
        key: seriesKey,
        channelId,
        channelLabel: dimension.channelLabel,
        groupId,
        groupName: dimension.groupName,
        label: dimension.channelLabel + ' · ' + dimension.groupName,
        unit: 'tokens' as const,
        color: QUOTA_COLORS[index % QUOTA_COLORS.length]!,
        points,
        latest
      }
    })
}

/** Build the token-spend contribution calendar, one row per channel+group. */
export function buildQuotaTokenHeatmap(
  samples: QuotaSample[],
  dimensions: QuotaAccountDimension[],
  options: { weeks?: number; now?: number; filter?: QuotaDashboardFilter } = {}
): QuotaTokenHeatmap {
  const weeks = Math.max(1, Math.min(104, Math.round(options.weeks ?? 53)))
  const now = options.now ?? Date.now()
  const calendar = buildQuotaCalendar([], { weeks, now })
  const series = buildQuotaDailySeries(samples, dimensions, {
    days: calendar.days.length,
    now,
    dayStarts: calendar.days.map((day) => day.dayStart),
    ...(options.filter ? { filter: options.filter } : {})
  })
  const latestMonthly = latestSamplesByAccountMetric(samples)
  const allowed = new Set(filterQuotaDimensions(dimensions, options.filter ?? { channelId: 'all', groupId: 'all' }).map((item) => item.accountId))
  const monthlyByGroup = new Map<string, number>()
  for (const dimension of dimensions) {
    if (!allowed.has(dimension.accountId)) continue
    const key = dimension.channelId + '\u0000' + dimension.groupId
    const monthly = latestMonthly.get(dimension.accountId + '\u0000hark-pool')
    if (monthly) monthlyByGroup.set(key, (monthlyByGroup.get(key) ?? 0) + monthly.limit)
  }
  const rows = series.map((item) => {
    const monthlyLimit = monthlyByGroup.get(item.key) ?? 0
    const byDay = new Map(item.points.filter((point) => point.spent !== null).map((point) => [point.dayStart, point]))
    const cells: QuotaTokenCell[] = calendar.days.map((day) => {
      const point = byDay.get(day.dayStart)
      return {
        dayStart: day.dayStart,
        spent: point?.spent ?? null,
        limit: point?.limit ?? 0,
        sharePercent: point && monthlyLimit > 0 ? (point.spent! / monthlyLimit) * 100 : null,
        sampleCount: point?.sampleCount ?? 0
      }
    })
    return {
      key: item.key,
      label: item.label,
      color: item.color,
      monthlyLimit,
      cells,
      levels: quotaHeatLevels(cells.map((cell) => cell.spent))
    }
  })
  return { calendar, rows }
}
