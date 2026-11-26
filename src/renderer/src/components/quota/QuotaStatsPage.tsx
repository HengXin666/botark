import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowLeft, BarChart3, CalendarDays, RefreshCw, Trash2, TrendingUp } from 'lucide-react'
import { PaneHeader } from '@/components/layout/PaneHeader'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { cn } from '@/lib/cn'
import { collectAndRecordQuotaUsage } from '@/lib/quotaUsageCollector'
import { useBotStore } from '@/store/botStore'
import { clearQuotaSamples, loadQuotaSamples, useQuotaSamples } from '@/lib/quotaUsageHistory'
import {
  buildQuotaAccountDimensions,
  buildQuotaDailySeries,
  buildQuotaTokenHeatmap,
  buildQuotaTokenSummary,
  filterQuotaDimensions,
  quotaFilterOptions,
  type QuotaDashboardFilter
} from '@/lib/quotaDashboard'
import { QuotaAccountTable } from './QuotaAccountTable'
import { QuotaFilters } from './QuotaFilters'
import { QuotaTokenHeatmapView } from './QuotaTokenHeatmap'
import { QuotaTokenLineChart } from './QuotaTokenLineChart'

const RANGE_OPTIONS = [7, 14, 30] as const
const tokenNumber = new Intl.NumberFormat('zh-CN')

function formatTokens(value: number): string {
  return tokenNumber.format(Math.max(0, Math.round(value)))
}

function formatReset(timestamp: number | null): string {
  if (!timestamp) return '所有账号合计'
  return '重置于 ' + new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function SummaryCard({
  icon,
  label,
  value,
  detail
}: {
  icon: React.ReactNode
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
        <span className="text-ink-secondary [&_svg]:size-3.5">{icon}</span>
        {label}
      </div>
      <p className="truncate text-[22px] leading-7 font-semibold tracking-tight text-ink tabular-nums">{value}</p>
      {detail && <p className="truncate text-[11px] text-ink-muted">{detail}</p>}
    </div>
  )
}

export function QuotaStatsPage({
  mobile = false,
  onClose
}: {
  mobile?: boolean
  onClose?: () => void
}) {
  const samples = useQuotaSamples()
  const accounts = useBotStore((s) => s.accounts)
  const bots = useBotStore((s) => s.bots)
  const groups = useBotStore((s) => s.groups)
  const [days, setDays] = useState<(typeof RANGE_OPTIONS)[number]>(14)
  const [filter, setFilter] = useState<QuotaDashboardFilter>({ channelId: 'all', groupId: 'all' })
  const [collecting, setCollecting] = useState(false)
  const [message, setMessage] = useState<string>()

  const close = useCallback(() => {
    if (onClose) {
      onClose()
      return
    }
    useBotStore.getState().setQuotaStatsOpen(false)
  }, [onClose])

  const refresh = useCallback(async () => {
    setCollecting(true)
    setMessage(undefined)
    try {
      const report = await collectAndRecordQuotaUsage()
      const hasHistory = loadQuotaSamples().length > 0
      setMessage(
        report.attempted === 0
          ? hasHistory
            ? '当前没有可读取的在线额度接口，已展示本机历史'
            : '当前没有可读取的在线额度接口'
          : [
              '已记录当前额度',
              report.failed > 0 ? report.failed + ' 个账号读取失败' : '',
              report.offline > 0 ? report.offline + ' 个账号未连接' : ''
            ]
              .filter(Boolean)
              .join('，')
      )
    } catch {
      setMessage('额度读取失败，请稍后重试')
    } finally {
      setCollecting(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const dimensions = useMemo(() => buildQuotaAccountDimensions(accounts, bots, groups), [accounts, bots, groups])
  const filterOptions = useMemo(() => quotaFilterOptions(dimensions), [dimensions])
  const filteredDimensions = useMemo(() => filterQuotaDimensions(dimensions, filter), [dimensions, filter])
  const filteredAccounts = useMemo(() => {
    const allowed = new Set(filteredDimensions.map((item) => item.accountId))
    return Object.fromEntries(Object.entries(accounts).filter(([accountId]) => allowed.has(accountId)))
  }, [accounts, filteredDimensions])
  const dailySeries = useMemo(
    () => buildQuotaDailySeries(samples, dimensions, { days, filter }),
    [samples, dimensions, days, filter]
  )
  const heatmap = useMemo(
    () => buildQuotaTokenHeatmap(samples, dimensions, { weeks: 53, filter }),
    [samples, dimensions, filter]
  )
  const summary = useMemo(
    () => buildQuotaTokenSummary(samples, filteredDimensions, accounts),
    [samples, filteredDimensions, accounts]
  )
  const activeChannel = filterOptions.channels.find((item) => item.id === filter.channelId)?.label ?? '全部渠道'
  const activeGroup = filterOptions.groups.find((item) => item.id === filter.groupId)?.label ?? '全部分组'
  const filterLabel = activeChannel + ' · ' + activeGroup

  const clear = () => {
    if (!window.confirm('清空本机保存的额度采样历史？')) return
    clearQuotaSamples()
    setMessage('已清空本机额度历史')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-main">
      <PaneHeader className={cn('gap-2 pr-3', mobile && 'mobile-safe-top')}>
        <IconButton label="返回" onClick={close}>
          <ArrowLeft />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-ink">额度统计</h1>
          <p className="truncate text-[11px] text-ink-muted">按渠道 + 分组聚合 · 精确 token 花费</p>
        </div>
        <div className="hidden items-center gap-0.5 rounded-full bg-hover p-0.5 sm:flex">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDays(option)}
              className={cn(
                'press h-7 rounded-full px-2.5 text-[11px] tabular-nums transition-colors',
                days === option ? 'bg-surface text-ink shadow-float' : 'text-ink-secondary hover:text-ink'
              )}
            >
              {option} 天
            </button>
          ))}
        </div>
        <IconButton label="刷新额度" onClick={() => void refresh()} disabled={collecting}>
          <RefreshCw className={cn(collecting && 'animate-spin')} />
        </IconButton>
        <IconButton label="清空额度历史" onClick={clear}>
          <Trash2 />
        </IconButton>
      </PaneHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn('mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5', mobile && 'pb-8')}>
          <div className="flex items-center gap-1.5 overflow-x-auto sm:hidden">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDays(option)}
                className={cn(
                  'press h-8 shrink-0 rounded-full border px-3 text-[11px] tabular-nums transition-colors',
                  days === option ? 'border-accent-600 bg-accent-50 text-accent-700' : 'border-line text-ink-secondary'
                )}
              >
                {option} 天
              </button>
            ))}
          </div>

          <QuotaFilters
            channels={filterOptions.channels}
            groups={filterOptions.groups}
            filter={filter}
            onChange={setFilter}
            accountCount={filteredDimensions.length}
          />

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <SummaryCard icon={<Activity />} label="账号" value={summary.connected + '/' + summary.accounts} detail={filterLabel} />
            <SummaryCard icon={<TrendingUp />} label="今日花费" value={formatTokens(summary.dailyUsed)} detail={'今日额度 ' + formatTokens(summary.dailyLimit)} />
            <SummaryCard icon={<CalendarDays />} label="本月总额度" value={formatTokens(summary.monthlyLimit)} detail={'已用 ' + formatTokens(summary.monthlyUsed)} />
            <SummaryCard icon={<BarChart3 />} label="本月剩余" value={formatTokens(summary.monthlyLimit - summary.monthlyUsed)} detail={formatReset(summary.monthlyResetsAt)} />
          </div>

          {message && <p className="text-[11.5px] text-ink-muted">{message}</p>}

          <section className="rounded-2xl border border-line bg-surface p-3.5 sm:p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-[13px] font-semibold text-ink">每日 Token 花费趋势</h2>
                <p className="mt-0.5 text-[11px] text-ink-muted">默认每个渠道 + 分组一条折线；同组账号按天求和</p>
              </div>
              <TrendingUp className="size-4 text-ink-muted" />
            </div>
            {dailySeries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[11.5px] text-ink-muted">
                当前筛选下还没有 token 花费采样。
              </div>
            ) : (
              <QuotaTokenLineChart series={dailySeries} days={days} />
            )}
          </section>

          <QuotaTokenHeatmapView heatmap={heatmap} />

          <QuotaAccountTable accounts={filteredAccounts} samples={samples} />

          {samples.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line px-5 py-12 text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-hover text-ink-secondary"><BarChart3 className="size-6" /></span>
              <div>
                <p className="text-[14px] font-medium text-ink">还没有额度采样</p>
                <p className="mt-1 max-w-md text-[12px] leading-5 text-ink-muted">先刷新一次记录当前额度；之后应用运行时会自动采样，历史只保存在本机。</p>
              </div>
              <Button variant="primary" size="sm" onClick={() => void refresh()} disabled={collecting}>
                <RefreshCw className={cn('size-3.5', collecting && 'animate-spin')} />记录当前额度
              </Button>
            </div>
          )}

          <div className="rounded-2xl border border-line bg-sunken/60 px-3.5 py-3 text-[11px] leading-5 text-ink-muted">
            <p className="font-medium text-ink-secondary">关于数据</p>
            <p className="mt-1">Hark 每日额度按天重置，月度/计费周期额度取 poolLimit 与 poolUsed；热力图展示每日实际花费 token，并同时保留本月总额度占比。额度来自各平台当前返回的订阅/账单接口，应用打开期间每 5 分钟采样一次，保留最近 400 天；首次打开只会从当前时刻开始积累，不会伪造历史。所有采样只保存在本机。</p>
          </div>
        </div>
      </div>
    </div>
  )
}
