import { useMemo } from 'react'
import type { ConnectionStatus } from '@adapters/types'
import type { BotAccount } from '@/types'
import type { QuotaSample } from '@shared/quotaUsage'
import { cn } from '@/lib/cn'

const tokenNumber = new Intl.NumberFormat('zh-CN')

function formatTokens(value: number): string {
  return tokenNumber.format(Math.max(0, Math.round(value)))
}

function accountName(account: BotAccount): string {
  return account.displayName?.trim() || account.handle?.trim() || account.label?.trim() || account.id
}

const STATUS_META: Record<ConnectionStatus, { label: string; className: string }> = {
  online: { label: '在线', className: 'bg-status-online/10 text-status-online-ink' },
  busy: { label: '工作中', className: 'bg-accent-600/10 text-accent-600' },
  attention: { label: '待处理', className: 'bg-status-attention/10 text-status-attention-ink' },
  offline: { label: '离线', className: 'bg-hover text-ink-muted' },
  error: { label: '连接错误', className: 'bg-status-error/10 text-status-error' }
}

function MiniStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-line bg-sunken/50 px-3 py-2">
      <p className="text-[10.5px] font-medium text-ink-muted">{label}</p>
      <p className="mt-0.5 truncate text-[17px] font-semibold tracking-tight text-ink tabular-nums">{value}</p>
      <p className="mt-0.5 truncate text-[10.5px] text-ink-muted">{detail}</p>
    </div>
  )
}

/**
 * Exact per-account token quotas. Hark's /billing/summary returns integer daily
 * and rolling-pool meters, so the dashboard must show tokens, not a rounded
 * percentage. Offline accounts remain in the table with their last sample.
 */
export function QuotaAccountTable({
  accounts,
  samples,
  platformId = 'hark'
}: {
  accounts: Record<string, BotAccount>
  samples: QuotaSample[]
  platformId?: string
}) {
  const latest = useMemo(() => {
    const map = new Map<string, QuotaSample>()
    for (const sample of samples) {
      const key = sample.accountId + '\u0000' + sample.metricKey
      const previous = map.get(key)
      if (!previous || sample.capturedAt >= previous.capturedAt) map.set(key, sample)
    }
    return map
  }, [samples])

  const rows = useMemo(
    () =>
      Object.values(accounts)
        .filter((account) => account.platformId === platformId)
        .sort((left, right) => {
          const rank = (account: BotAccount) =>
            account.status === 'online' || account.status === 'busy' || account.status === 'attention' ? 0 : 1
          return rank(left) - rank(right) || accountName(left).localeCompare(accountName(right), 'zh-CN')
        })
        .map((account) => ({
          account,
          daily: latest.get(account.id + '\u0000' + 'hark-daily'),
          pool: latest.get(account.id + '\u0000' + 'hark-pool')
        })),
    [accounts, latest, platformId]
  )

  const totals = useMemo(() => {
    let dailyLimit = 0
    let dailyUsed = 0
    let poolLimit = 0
    let poolUsed = 0
    for (const row of rows) {
      if (row.daily) {
        dailyLimit += row.daily.limit
        dailyUsed += row.daily.used
      }
      if (row.pool) {
        poolLimit += row.pool.limit
        poolUsed += row.pool.used
      }
    }
    return { dailyLimit, dailyUsed, poolLimit, poolUsed }
  }, [rows])

  const online = rows.filter((row) => row.account.status === 'online' || row.account.status === 'busy').length
  const label = platformId === 'hark' ? 'Hark' : platformId

  return (
    <section className="rounded-2xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold text-ink">{label} 账号额度（精确 token）</h2>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            按账号展示接口返回的原始 token 数；离线账号保留最近一次采样，不伪造额度。
          </p>
        </div>
        <span className="rounded-full bg-hover px-2.5 py-1 text-[10.5px] tabular-nums text-ink-secondary">
          {rows.length} 个账号 · {online} 已连接 · {rows.length - online} 离线/错误
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat label="今日花费" value={formatTokens(totals.dailyUsed)} detail={'今日额度 ' + formatTokens(totals.dailyLimit)} />
        <MiniStat label="今日剩余" value={formatTokens(totals.dailyLimit - totals.dailyUsed)} detail={totals.dailyLimit ? '所有账号合计' : '暂无采样'} />
        <MiniStat label="本月已用" value={formatTokens(totals.poolUsed)} detail={'本月总额 ' + formatTokens(totals.poolLimit)} />
        <MiniStat label="本月剩余" value={formatTokens(totals.poolLimit - totals.poolUsed)} detail={totals.poolLimit ? '所有账号合计' : '暂无采样'} />
      </div>

      <div className="max-h-[30rem] overflow-auto rounded-xl border border-line">
        <table className="min-w-[980px] w-full border-collapse text-left text-[11.5px]">
          <thead className="sticky top-0 z-10 bg-sunken text-[10.5px] text-ink-muted">
            <tr>
              <th className="px-3 py-2 font-medium">账号</th>
              <th className="px-2 py-2 font-medium">状态</th>
              <th className="px-2 py-2 text-right font-medium">今日已用</th>
              <th className="px-2 py-2 text-right font-medium">今日额度</th>
              <th className="px-2 py-2 text-right font-medium">本月已用</th>
              <th className="px-2 py-2 text-right font-medium">本月总额</th>
              <th className="px-2 py-2 text-right font-medium">本月剩余</th>
              <th className="px-3 py-2 text-right font-medium">最近采样</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ account, daily, pool }) => {
              const status = STATUS_META[account.status] ?? STATUS_META.offline
              const capturedAt = Math.max(daily?.capturedAt ?? 0, pool?.capturedAt ?? 0)
              return (
                <tr key={account.id} className="border-t border-line/70 hover:bg-hover/40">
                  <td className="max-w-[220px] truncate px-3 py-1.5 font-medium text-ink" title={accountName(account)}>
                    {accountName(account)}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={cn('inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium', status.className)}>
                      {status.label}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-secondary">{daily ? formatTokens(daily.used) : '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink">{daily ? formatTokens(daily.limit) : '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-secondary">{pool ? formatTokens(pool.used) : '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink">{pool ? formatTokens(pool.limit) : '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-secondary">{pool ? formatTokens(pool.limit - pool.used) : '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-muted">
                    {capturedAt ? new Date(capturedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
