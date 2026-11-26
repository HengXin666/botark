/**
 * Quota-usage history shared by the Linux dashboard and the Android WebView.
 *
 * Providers only expose the current quota (Muse percent, Hark token meters,
 * Dot rate limits), so history is sampled locally over time. These helpers
 * keep deduplication, day buckets and chart series deterministic and testable.
 */

export type QuotaUnit = 'percent' | 'tokens'

export interface QuotaSample {
  accountId: string
  platformId: string
  accountName: string
  metricKey: string
  metricLabel: string
  windowLabel?: string
  unit: QuotaUnit
  used: number
  limit: number
  capturedAt: number
  /** Reset instant of the quota window, when the provider exposes it. */
  periodEnd?: number
}

export interface QuotaSeriesPoint {
  capturedAt: number
  used: number
  limit: number
  percent: number
}

export interface QuotaSeries {
  key: string
  accountId: string
  platformId: string
  accountName: string
  metricKey: string
  label: string
  windowLabel?: string
  unit: QuotaUnit
  color: string
  points: QuotaSeriesPoint[]
  latest: QuotaSeriesPoint | null
}

export interface QuotaHeatmapCell {
  dayStart: number
  sample: QuotaSample | null
  percent: number | null
}

export interface QuotaHeatmapRow {
  key: string
  accountId: string
  accountName: string
  metricLabel: string
  unit: QuotaUnit
  color: string
  cells: QuotaHeatmapCell[]
}

export interface QuotaCalendarDay {
  dayStart: number
  /** Highest sampled usage across all quota metrics that day, 0-100. */
  percent: number | null
  /** Number of account/metric series sampled that day. */
  sampleCount: number
  /** The metric that produced the highest reading, for the tooltip. */
  topLabel?: string
}

export interface QuotaCalendarMonth {
  /** Zero-based week index in the calendar grid. */
  week: number
  label: string
}

/** A Codex-style contribution calendar: weeks as columns, Monday-to-Sunday rows. */
export interface QuotaCalendar {
  from: number
  to: number
  weeks: number
  days: QuotaCalendarDay[]
  months: QuotaCalendarMonth[]
}

const DAY_MS = 86_400_000

/** Keep enough history for a 53-week contribution-style calendar. */
export const QUOTA_HISTORY_DAYS = 400

export const QUOTA_COLORS = [
  '#1680f3',
  '#f59e0b',
  '#10b981',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#64748b'
] as const

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

export function quotaPercent(sample: Pick<QuotaSample, 'used' | 'limit' | 'unit'>): number {
  if (sample.unit === 'percent') return clampPercent(sample.used)
  if (!Number.isFinite(sample.limit) || sample.limit <= 0) return 0
  return clampPercent((sample.used / sample.limit) * 100)
}

/** Local midnight, so a user's "today" is stable across timezone changes. */
export function quotaDayStart(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeSample(sample: QuotaSample): QuotaSample | null {
  if (!sample || typeof sample !== 'object') return null
  if (!sample.accountId || !sample.metricKey || !sample.metricLabel) return null
  if (!isFiniteNumber(sample.capturedAt) || !isFiniteNumber(sample.used) || !isFiniteNumber(sample.limit)) {
    return null
  }
  return {
    ...sample,
    accountName: sample.accountName || sample.accountId,
    platformId: sample.platformId || 'unknown',
    unit: sample.unit === 'percent' ? 'percent' : 'tokens',
    used: Math.max(0, sample.used),
    limit: Math.max(0, sample.limit)
  }
}

/**
 * Merge samples into history. A provider refresh can happen several times a
 * day; keep only the latest reading for each series/day, prune old data, and
 * keep a hard cap so localStorage cannot grow without bound.
 */
export function appendQuotaSamples(
  existing: QuotaSample[],
  incoming: QuotaSample[],
  options: { now?: number; maxAgeDays?: number; maxSamples?: number } = {}
): QuotaSample[] {
  const now = options.now ?? Date.now()
  const maxAgeDays = options.maxAgeDays ?? QUOTA_HISTORY_DAYS
  const maxSamples = options.maxSamples ?? 5000
  const cutoff = now - maxAgeDays * DAY_MS
  const byDay = new Map<string, QuotaSample>()

  for (const candidate of [...existing, ...incoming]) {
    const sample = normalizeSample(candidate)
    if (!sample || sample.capturedAt < cutoff || sample.capturedAt > now + 60_000) continue
    const key = [sample.accountId, sample.metricKey, quotaDayStart(sample.capturedAt)].join('\u0000')
    const previous = byDay.get(key)
    if (!previous || sample.capturedAt >= previous.capturedAt) byDay.set(key, sample)
  }

  return [...byDay.values()]
    .sort((left, right) => left.capturedAt - right.capturedAt)
    .slice(-maxSamples)
}

function seriesKey(accountId: string, metricKey: string): string {
  return accountId + '::' + metricKey
}

export function buildQuotaSeries(
  samples: QuotaSample[],
  options: { days?: number; now?: number } = {}
): QuotaSeries[] {
  const now = options.now ?? Date.now()
  const days = Math.max(1, Math.min(90, Math.round(options.days ?? 14)))
  const start = quotaDayStart(now) - (days - 1) * DAY_MS
  const groups = new Map<string, QuotaSample[]>()

  for (const sample of samples) {
    if (!sample || sample.capturedAt < start || sample.capturedAt > now + 60_000) continue
    const key = seriesKey(sample.accountId, sample.metricKey)
    const list = groups.get(key) ?? []
    list.push(sample)
    groups.set(key, list)
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, list], index) => {
      const samplesByDay = new Map<number, QuotaSample>()
      for (const sample of list) {
        const day = quotaDayStart(sample.capturedAt)
        const previous = samplesByDay.get(day)
        if (!previous || sample.capturedAt >= previous.capturedAt) samplesByDay.set(day, sample)
      }
      const points: QuotaSeriesPoint[] = [...samplesByDay.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, sample]) => ({
          capturedAt: sample.capturedAt,
          used: sample.used,
          limit: sample.limit,
          percent: quotaPercent(sample)
        }))
      const first = list[0]!
      return {
        key,
        accountId: first.accountId,
        platformId: first.platformId,
        accountName: first.accountName || first.accountId,
        metricKey: first.metricKey,
        label: first.metricLabel,
        ...(first.windowLabel ? { windowLabel: first.windowLabel } : {}),
        unit: first.unit,
        color: QUOTA_COLORS[index % QUOTA_COLORS.length]!,
        points,
        latest: points.at(-1) ?? null
      }
    })
}

export function quotaRangeDays(options: { days?: number; now?: number } = {}): number[] {
  const now = options.now ?? Date.now()
  const days = Math.max(1, Math.min(90, Math.round(options.days ?? 14)))
  const start = quotaDayStart(now) - (days - 1) * DAY_MS
  return Array.from({ length: days }, (_, index) => start + index * DAY_MS)
}

/**
 * Grid/heatmap view: one row per account metric and one cell per local day.
 * Missing days stay null so the UI can show a real "no sample" state instead
 * of drawing a misleading zero.
 */
export function buildQuotaHeatmap(
  samples: QuotaSample[],
  options: { days?: number; now?: number } = {}
): QuotaHeatmapRow[] {
  const now = options.now ?? Date.now()
  const days = quotaRangeDays({ days: options.days, now })
  const series = buildQuotaSeries(samples, { days: options.days, now })
  return series.map((item) => {
    const byDay = new Map<number, QuotaSeriesPoint>()
    for (const point of item.points) byDay.set(quotaDayStart(point.capturedAt), point)
    return {
      key: item.key,
      accountId: item.accountId,
      accountName: item.accountName,
      metricLabel: item.label,
      unit: item.unit,
      color: item.color,
      cells: days.map((dayStart) => {
        const point = byDay.get(dayStart)
        return {
          dayStart,
          sample: null,
          percent: point ? point.percent : null
        }
      })
    }
  })
}

function addLocalDays(dayStart: number, days: number): number {
  const date = new Date(dayStart)
  date.setDate(date.getDate() + days)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Build the last N weeks as a contribution-calendar grid, Monday first.
 * Each cell is the highest quota percentage observed that day across all
 * account/metric series; gaps stay null instead of becoming a fake 0%.
 */
export function buildQuotaCalendar(
  samples: QuotaSample[],
  options: { weeks?: number; now?: number } = {}
): QuotaCalendar {
  const now = options.now ?? Date.now()
  const weeks = Math.max(1, Math.min(104, Math.round(options.weeks ?? 53)))
  const today = quotaDayStart(now)
  const mondayOffset = (new Date(today).getDay() + 6) % 7
  const currentWeekMonday = addLocalDays(today, -mondayOffset)
  const from = addLocalDays(currentWeekMonday, -(weeks - 1) * 7)
  const to = addLocalDays(currentWeekMonday, 6)

  const byDay = new Map<number, Map<string, QuotaSample>>()
  for (const sample of samples) {
    if (!sample || !Number.isFinite(sample.capturedAt)) continue
    const dayStart = quotaDayStart(sample.capturedAt)
    if (dayStart < from || dayStart > to) continue
    const series = [sample.accountId, sample.metricKey].join('\u0000')
    const bucket = byDay.get(dayStart) ?? new Map<string, QuotaSample>()
    const previous = bucket.get(series)
    if (!previous || sample.capturedAt >= previous.capturedAt) bucket.set(series, sample)
    byDay.set(dayStart, bucket)
  }

  const days: QuotaCalendarDay[] = []
  for (let offset = 0; offset < weeks * 7; offset++) {
    const dayStart = addLocalDays(from, offset)
    const bucket = byDay.get(dayStart)
    if (!bucket || dayStart > today) {
      days.push({ dayStart, percent: null, sampleCount: 0 })
      continue
    }
    let topSample: QuotaSample | undefined
    let topPercent = -1
    for (const sample of bucket.values()) {
      const percent = quotaPercent(sample)
      if (percent > topPercent) {
        topPercent = percent
        topSample = sample
      }
    }
    days.push({
      dayStart,
      percent: topSample ? topPercent : null,
      sampleCount: bucket.size,
      ...(topSample ? { topLabel: topSample.accountName + ' · ' + topSample.metricLabel } : {})
    })
  }

  const months: QuotaCalendarMonth[] = []
  let lastMonth = -1
  let lastLabelWeek = -99
  days.forEach((day, index) => {
    if (index % 7 !== 0) return
    const date = new Date(day.dayStart)
    const month = date.getMonth()
    if (month === lastMonth) return
    lastMonth = month
    const week = index / 7
    if (week >= weeks - 1) return
    // Avoid a clipped first month and keep at least three weeks between
    // labels, matching the contribution-calendar convention.
    if (week === 0 && date.getDate() > 14) return
    if (lastLabelWeek >= 0 && week - lastLabelWeek < 3) return
    months.push({ week, label: date.toLocaleDateString('zh-CN', { month: 'short' }) })
    lastLabelWeek = week
  })

  return { from, to, weeks, days, months }
}

/**
 * Grade daily values into 0-4 heat levels, using quartiles when there are
 * enough non-zero days and a share-of-busiest fallback for a sparse history.
 * This mirrors Magpie / Codex contribution heatmaps.
 */
export function quotaHeatLevels(values: Array<number | null>): number[] {
  const nonZero = values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right)
  if (!nonZero.length) return values.map(() => 0)
  if (nonZero.length < 8) {
    const busiest = nonZero[nonZero.length - 1]!
    return values.map((value) =>
      typeof value !== 'number' || value <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((4 * value) / busiest - 1e-9)))
    )
  }
  const quantile = (p: number) => nonZero[Math.min(nonZero.length - 1, Math.floor(p * nonZero.length))]!
  const [lower, middle, upper] = [quantile(0.25), quantile(0.5), quantile(0.75)]
  const busiest = nonZero[nonZero.length - 1]!
  return values.map((value) => {
    if (typeof value !== 'number' || value <= 0) return 0
    if (value >= busiest) return 4
    if (value <= lower) return 1
    if (value <= middle) return 2
    if (value <= upper) return 3
    return 4
  })
}

export function quotaValueLabel(sample: Pick<QuotaSample, 'used' | 'limit' | 'unit'>): string {
  if (sample.unit === 'percent') return Math.round(clampPercent(sample.used)) + '%'
  if (sample.limit <= 0) return String(Math.round(sample.used))
  return Math.round(sample.used).toLocaleString() + ' / ' + Math.round(sample.limit).toLocaleString()
}
