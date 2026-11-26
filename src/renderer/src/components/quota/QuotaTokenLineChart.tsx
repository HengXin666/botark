import { useMemo } from 'react'
import type { QuotaDailySeries } from '@/lib/quotaDashboard'
import { quotaDayStart, quotaRangeDays } from '@shared/quotaUsage'

const CHART_WIDTH = 760
const CHART_HEIGHT = 270
const PAD_LEFT = 56
const PAD_RIGHT = 18
const PAD_TOP = 18
const PAD_BOTTOM = 30
const tokenNumber = new Intl.NumberFormat('zh-CN')

function formatTokens(value: number): string {
  return tokenNumber.format(Math.max(0, Math.round(value)))
}

function formatCompactTokens(value: number): string {
  if (value >= 1_000_000_000) return (value / 1_000_000_000).toFixed(1) + 'B'
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M'
  if (value >= 1_000) return (value / 1_000).toFixed(0) + 'K'
  return String(Math.round(value))
}

function niceMax(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const scaled = value / magnitude
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10
  return step * magnitude
}

function formatDay(dayStart: number, compact = false): string {
  return new Date(dayStart).toLocaleDateString('zh-CN', compact ? { month: 'numeric', day: 'numeric' } : { month: 'short', day: 'numeric' })
}

/** Daily token spend for the selected channel/group series. */
export function QuotaTokenLineChart({ series, days }: { series: QuotaDailySeries[]; days: number }) {
  const dayStarts = useMemo(() => quotaRangeDays({ days }), [days])
  const dayIndex = useMemo(() => new Map(dayStarts.map((day, index) => [day, index])), [dayStarts])
  const innerWidth = CHART_WIDTH - PAD_LEFT - PAD_RIGHT
  const innerHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM
  const maxValue = useMemo(
    () => niceMax(Math.max(1, ...series.flatMap((item) => item.points.map((point) => point.spent ?? 0)))),
    [series]
  )
  const xFor = (timestamp: number) => {
    const index = dayIndex.get(quotaDayStart(timestamp)) ?? 0
    return PAD_LEFT + (dayStarts.length <= 1 ? innerWidth / 2 : (index / (dayStarts.length - 1)) * innerWidth)
  }
  const yFor = (value: number) => PAD_TOP + (1 - value / maxValue) * innerHeight
  const xLabelEvery = Math.max(1, Math.ceil(dayStarts.length / 6))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {series.map((item) => (
          <span key={item.key} className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-ink-secondary">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="max-w-[220px] truncate">{item.label}</span>
            {item.latest && <span className="tabular-nums text-ink">{formatTokens(item.latest.spent ?? 0)} token</span>}
          </span>
        ))}
      </div>
      <svg role="img" aria-label="每日 token 花费折线图" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="h-[230px] w-full overflow-visible sm:h-[270px]">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = maxValue * ratio
          const y = yFor(value)
          return (
            <g key={ratio}>
              <line x1={PAD_LEFT} x2={CHART_WIDTH - PAD_RIGHT} y1={y} y2={y} stroke="currentColor" className="text-line" strokeWidth="1" />
              <text x={PAD_LEFT - 8} y={y + 4} textAnchor="end" className="fill-ink-muted text-[10px] tabular-nums">
                {formatCompactTokens(value)}
              </text>
            </g>
          )
        })}
        {dayStarts.map((day, index) =>
          index % xLabelEvery === 0 || index === dayStarts.length - 1 ? (
            <text
              key={day}
              x={PAD_LEFT + (dayStarts.length <= 1 ? innerWidth / 2 : (index / (dayStarts.length - 1)) * innerWidth)}
              y={CHART_HEIGHT - 8}
              textAnchor="middle"
              className="fill-ink-muted text-[10px]"
            >
              {formatDay(day, true)}
            </text>
          ) : null
        )}
        {series.map((item) => {
          const segments: string[] = []
          let current = ''
          for (const point of item.points) {
            if (point.spent === null) {
              if (current) segments.push(current)
              current = ''
              continue
            }
            const command = current ? 'L' : 'M'
            current += ` ${command} ${xFor(point.dayStart).toFixed(2)} ${yFor(point.spent).toFixed(2)}`
          }
          if (current) segments.push(current)
          return (
            <g key={item.key}>
              {segments.map((segment, index) => (
                <path key={index} d={segment} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              ))}
              {item.points.map((point) =>
                point.spent === null ? null : (
                  <circle key={point.dayStart} cx={xFor(point.dayStart)} cy={yFor(point.spent)} r="3.2" fill={item.color} stroke="white" strokeWidth="1.5">
                    <title>{item.label + ' · ' + formatDay(point.dayStart) + ' · ' + formatTokens(point.spent) + ' token'}</title>
                  </circle>
                )
              )}
            </g>
          )
        })}
      </svg>
      <p className="text-[11px] text-ink-muted">纵轴为每日花费 token；同一天多次采样只保留最后一次。</p>
    </div>
  )
}
