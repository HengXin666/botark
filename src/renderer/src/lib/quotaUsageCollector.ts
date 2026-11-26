import { useEffect } from 'react'
import type { QuotaSample } from '@shared/quotaUsage'
import { getBridge } from '@/lib/bridge'
import { recordQuotaSamples } from '@/lib/quotaUsageHistory'
import { samplesFromDotRateLimits, samplesFromHarkSummary, samplesFromMuseSnapshot } from '@/lib/quotaUsageSources'
import { useBotStore } from '@/store/botStore'

export interface QuotaCollectReport {
  samples: QuotaSample[]
  attempted: number
  failed: number
  /** Supported accounts skipped because they are offline/error. */
  offline: number
  /** Accounts whose platform exposes no quota API. */
  unsupported: number
}

function accountName(account: { displayName?: string; handle?: string; id: string }): string {
  return account.displayName?.trim() || account.handle?.trim() || account.id
}

/**
 * Probe whichever quota APIs the current shell exposes. Desktop has Muse,
 * Hark and Dot bridges; the Android shell exposes Hark directly. Unsupported
 * platforms are skipped rather than reported as errors.
 */
export async function collectQuotaUsage(now = Date.now()): Promise<QuotaCollectReport> {
  const state = useBotStore.getState()
  const supported = Object.values(state.accounts).filter(
    (account) =>
      account.platformId === 'meta-muse' || account.platformId === 'hark' || account.platformId === 'dot'
  )
  // Quota pages must account for every account. Offline rows are reported as
  // offline instead of disappearing; only connected accounts are probed.
  const accounts = supported.filter(
    (account) => account.status === 'online' || account.status === 'busy' || account.status === 'attention'
  )
  const collected: QuotaSample[] = []
  let attempted = 0
  let failed = 0

  const run = async (account: (typeof accounts)[number]): Promise<void> => {
    const name = accountName(account)
    if (account.platformId === 'meta-muse') {
      const muse = getBridge()?.muse
      if (!muse?.refreshQuota) return
      attempted += 1
      try {
        const snapshot = await muse.refreshQuota(account.id)
        collected.push(...samplesFromMuseSnapshot(account.id, name, snapshot, now))
      } catch {
        failed += 1
      }
      return
    }
    if (account.platformId === 'hark') {
      const hark = getBridge()?.hark
      if (!hark?.rpc) return
      attempted += 1
      try {
        const result = await hark.rpc({
          accountId: account.id,
          op: 'call',
          method: 'GET',
          path: '/billing/summary'
        })
        if (!result.ok) throw new Error(result.message || 'Hark billing unavailable')
        collected.push(...samplesFromHarkSummary(account.id, name, result.data, now))
      } catch {
        failed += 1
      }
      return
    }
    if (account.platformId === 'dot') {
      const dot = getBridge()?.dot
      if (!dot?.rpc) return
      attempted += 1
      try {
        const result = await dot.rpc({ accountId: account.id, op: 'rateLimits' })
        if (!result.ok) throw new Error(result.message || 'Dot rate limits unavailable')
        collected.push(...samplesFromDotRateLimits(account.id, name, result.data, now))
      } catch {
        failed += 1
      }
    }
  }

  // Keep Hark's 80 accounts from opening 80 TLS/keychain requests at once.
  const concurrency = 6
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < accounts.length) {
      const account = accounts[cursor++]
      if (account) await run(account)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, accounts.length) }, () => worker()))
  return {
    samples: collected,
    attempted,
    failed,
    offline: supported.length - accounts.length,
    unsupported: Object.values(state.accounts).length - supported.length
  }
}

export async function collectAndRecordQuotaUsage(now = Date.now()): Promise<QuotaCollectReport> {
  const report = await collectQuotaUsage(now)
  if (report.samples.length > 0) recordQuotaSamples(report.samples, now)
  return report
}

/** Sample on mount and every few minutes while a shell is open. */
export function useQuotaUsageCollector(intervalMs = 5 * 60_000): void {
  useEffect(() => {
    let disposed = false
    const run = () => {
      if (disposed) return
      void collectAndRecordQuotaUsage()
    }
    run()
    const timer = window.setInterval(run, intervalMs)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [intervalMs])
}
