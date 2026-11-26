import { useMemo, useState } from 'react'
import { Flame } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { QuotaTokenHeatmap } from '@/lib/quotaDashboard'

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const
const HEAT_LEVEL_CLASSES = [
  'bg-hover',
  'bg-accent-600/20',
  'bg-accent-600/40',
  'bg-accent-600/65',
  'bg-accent-600'
] as const

const tokenNumber = new Intl.NumberFormat('zh-CN')

function formatTokens(value: number): string {
  return tokenNumber.format(Math.max(0, Math.round(value)))
}

function formatDay(dayStart: number): string {
  return new Date(dayStart).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

/**
 * 53-week contribution heatmap of token spend. Each row is a channel + group
 * aggregate, so an 80-account Hark workspace is readable at a glance. Cell
 * colour is relative daily spend; hover text always carries exact tokens and
 * the share of that row's monthly quota.
 */
export function QuotaTokenHeatmapView({ heatmap }: { heatmap: QuotaTokenHeatmap }) {
  const { calendar, rows } = heatmap
  const [hovered, setHovered] = useState<{ date: string; detail: string; x: number; y: number }>()
  const cellSize = 11
  const rowLabelWidth = 28
  const totalSamples = useMemo(
    () => rows.reduce((sum, row) => sum + row.cells.filter((cell) => cell.spent !== null).length, 0),
    [rows]
  )

  return (
    <section className="rounded-2xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <Flame className="size-3.5 text-accent-600" aria-hidden />
            Token 花费热力图
          </h2>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            按渠道 + 分组聚合每日 token 花费；颜色越深代表当天花费越多，悬浮可看精确 token 数与本月额度占比。
          </p>
        </div>
        <span className="rounded-full bg-hover px-2.5 py-1 text-[10.5px] tabular-nums text-ink-secondary">
          {rows.length} 个渠道分组 · {totalSamples} 天有采样
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[11.5px] text-ink-muted">
          当前筛选下还没有 token 花费采样。
        </div>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div className="flex w-max flex-col gap-4">
            {rows.map((row) => {
              const sampled = row.cells.filter((cell) => cell.spent !== null).length
              const totalSpent = row.cells.reduce((sum, cell) => sum + (cell.spent ?? 0), 0)
              return (
                <div key={row.key} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-ink">
                      <span className="size-2 rounded-full" style={{ backgroundColor: row.color }} aria-hidden />
                      {row.label}
                    </span>
                    <span className="text-[10.5px] tabular-nums text-ink-muted">
                      本月额度 {formatTokens(row.monthlyLimit)} · 已花费 {formatTokens(totalSpent)} · {sampled} 天有采样
                    </span>
                  </div>
                  <div
                    role="img"
                    aria-label={row.label + ' 的每日 token 花费热力图，最近 ' + calendar.weeks + ' 周'}
                    className="grid w-max"
                    style={{
                      gridTemplateColumns: rowLabelWidth + 'px repeat(' + calendar.weeks + ', ' + cellSize + 'px)',
                      gridTemplateRows: '15px repeat(7, ' + cellSize + 'px)',
                      columnGap: 2,
                      rowGap: 2
                    }}
                  >
                    {calendar.months.map((month, index) => {
                      const next = calendar.months[index + 1]
                      return (
                        <span
                          key={month.week + ':' + month.label}
                          className="truncate text-[10px] leading-none text-ink-muted"
                          style={{ gridColumn: month.week + 2 + ' / ' + ((next?.week ?? calendar.weeks) + 2), gridRow: 1 }}
                        >
                          {month.label}
                        </span>
                      )
                    })}
                    {WEEKDAY_LABELS.map((label, index) =>
                      index % 2 === 0 ? (
                        <span
                          key={label}
                          className="whitespace-nowrap text-[10px] leading-none text-ink-muted"
                          style={{ gridColumn: 1, gridRow: index + 2 }}
                        >
                          {label}
                        </span>
                      ) : null
                    )}
                    {row.cells.map((cell, index) => {
                      const week = Math.floor(index / 7)
                      const weekday = index % 7
                      const level = row.levels[index] ?? 0
                      const weekdayLabel = new Date(cell.dayStart).toLocaleDateString('zh-CN', { weekday: 'short' })
                      const dateLabel = formatDay(cell.dayStart) + ' ' + weekdayLabel
                      const detail =
                        cell.spent === null
                          ? '暂无采样'
                          : '花费 ' +
                            formatTokens(cell.spent) +
                            ' token' +
                            (cell.sharePercent === null ? '' : ' · 占本月额度 ' + cell.sharePercent.toFixed(2) + '%') +
                            (cell.sampleCount > 1 ? ' · ' + cell.sampleCount + ' 条采样' : '')
                      const title = dateLabel + ' · ' + detail
                      return (
                        <span
                          key={cell.dayStart}
                          role="img"
                          title={title}
                          aria-label={title}
                          onPointerEnter={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect()
                            setHovered({ date: dateLabel, detail, x: rect.left + rect.width / 2, y: rect.top - 8 })
                          }}
                          onPointerLeave={() => setHovered(undefined)}
                          className={cn(
                            'block rounded-[3px] transition-colors hover:outline hover:outline-1 hover:outline-offset-[-1px] hover:outline-ink-secondary',
                            cell.spent === null ? 'border border-line/60 bg-sunken' : HEAT_LEVEL_CLASSES[level]
                          )}
                          style={{ gridColumn: week + 2, gridRow: weekday + 2 }}
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-ink-muted">
        <span>空白格表示当天没有采样；不同分组的额度互不换算。</span>
        <span className="flex items-center gap-1.5">少
          {HEAT_LEVEL_CLASSES.map((className) => (
            <span key={className} className={cn('size-2.5 rounded-[2px]', className)} aria-hidden="true" />
          ))}
          多
        </span>
      </div>
      {hovered && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-2.5 py-2 text-[11px] shadow-float"
          style={{ left: hovered.x, top: hovered.y }}
        >
          <p className="font-medium text-ink">{hovered.date}</p>
          <p className="mt-0.5 whitespace-nowrap text-ink-muted">{hovered.detail}</p>
        </div>
      )}
    </section>
  )
}
