import { Filter, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { QuotaDashboardFilter } from '@/lib/quotaDashboard'

export function QuotaFilters({
  channels,
  groups,
  filter,
  onChange,
  accountCount
}: {
  channels: Array<{ id: string; label: string; count: number }>
  groups: Array<{ id: string; label: string; count: number }>
  filter: QuotaDashboardFilter
  onChange: (filter: QuotaDashboardFilter) => void
  accountCount: number
}) {
  const dirty = filter.channelId !== 'all' || filter.groupId !== 'all'
  return (
    <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-3.5 py-2.5" aria-label="额度筛选">
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-secondary">
        <Filter className="size-3.5" aria-hidden />
        筛选
      </span>
      <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
        渠道
        <select
          aria-label="按渠道筛选"
          value={filter.channelId}
          onChange={(event) => onChange({ ...filter, channelId: event.target.value })}
          className="h-7 rounded-lg border border-line bg-surface px-2 text-[11px] text-ink outline-none focus:border-accent-600"
        >
          <option value="all">全部渠道</option>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.label} ({channel.count})
            </option>
          ))}
        </select>
      </label>
      <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
        分组
        <select
          aria-label="按分组筛选"
          value={filter.groupId}
          onChange={(event) => onChange({ ...filter, groupId: event.target.value })}
          className="h-7 rounded-lg border border-line bg-surface px-2 text-[11px] text-ink outline-none focus:border-accent-600"
        >
          <option value="all">全部分组</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.label} ({group.count})
            </option>
          ))}
        </select>
      </label>
      <span className="text-[10.5px] tabular-nums text-ink-muted">{accountCount} 个账号</span>
      <button
        type="button"
        onClick={() => onChange({ channelId: 'all', groupId: 'all' })}
        disabled={!dirty}
        className={cn(
          'press ml-auto inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[10.5px]',
          dirty ? 'text-ink-secondary hover:bg-hover' : 'cursor-default text-ink-faint'
        )}
      >
        <RotateCcw className="size-3" aria-hidden />
        重置
      </button>
    </section>
  )
}
