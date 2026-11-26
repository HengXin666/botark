import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, Shuffle } from 'lucide-react'
import type { MuseProxyMode, MuseProxyTestResult, MuseProxyView } from '@shared/ipc'
import { EmptyLine, Section } from '@/components/info/Section'
import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/Field'
import { RefreshButton } from '@/components/muse/RefreshButton'
import { getBridge } from '@/lib/bridge'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n'
import { useBotStore } from '@/store/botStore'

const MODES: Array<{ value: MuseProxyMode; label: () => string }> = [
  { value: 'direct', label: () => t('Direct (no proxy)') },
  { value: 'http', label: () => t('HTTP proxy') },
  { value: 'https', label: () => t('HTTPS proxy') },
  { value: 'socks5', label: () => t('SOCKS5') },
  { value: 'socks5h', label: () => t('SOCKS5H (remote DNS)') }
]

/**
 * Per-account isolated egress proxy across all 4 platforms (partition + WSS/RPC transport).
 * Password stored via OS Keychain (`safeStorage`) with fail-closed leak protection.
 */
export function ProxySection({ accountId }: { accountId: string }) {
  const platformId = useBotStore((s) => s.accounts[accountId]?.platformId)
  const [view, setView] = useState<MuseProxyView | null>(null)
  const [mode, setMode] = useState<MuseProxyMode>('direct')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [hint, setHint] = useState<string>()
  const [poolItems, setPoolItems] = useState<Array<{ id: string; mode: string; host: string; port: number }>>([])
  const [selectedPoolId, setSelectedPoolId] = useState('')
  const [picking, setPicking] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<MuseProxyTestResult | null>(null)

  const refresh = useCallback(async () => {
    const muse = getBridge()?.muse
    if (!muse?.getProxy) {
      setView(null)
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const next = await muse.getProxy(accountId)
      setView(next)
      setMode(next.mode)
      setHost(next.host || '')
      setPort(next.port != null ? String(next.port) : '')
      setUsername(next.username || '')
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const refreshPool = useCallback(async () => {
    const muse = getBridge()?.muse
    if (!muse?.listProxyPool) return
    try {
      const items = await muse.listProxyPool()
      setPoolItems(items.map((i) => ({ id: i.id, mode: i.mode, host: i.host, port: i.port })))
    } catch {
      /* pool may be unavailable; keep the previous list */
    }
  }, [])

  useEffect(() => {
    void refreshPool()
  }, [refreshPool])

  const pickFromPool = async (id: string) => {
    setSelectedPoolId(id)
    if (!id) return
    const muse = getBridge()?.muse
    if (!muse?.getProxyPoolItemSecret) return
    setPicking(true)
    setError(undefined)
    try {
      const node = await muse.getProxyPoolItemSecret(id)
      if (!node) throw new Error('代理节点不可读')
      setMode(node.mode)
      setHost(node.host)
      setPort(String(node.port))
      setUsername(node.username || '')
      setPassword(node.password || '')
      setHint(`已选中订阅节点 ${node.host}:${node.port}，点击保存代理生效`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPicking(false)
    }
  }
  /** One click: probe the pool, drop dead nodes and bind a free working proxy. */
  const assignNextAvailable = async () => {
    const muse = getBridge()?.muse
    if (!muse?.assignNextAvailableProxy) return
    setAssigning(true)
    setError(undefined)
    setHint(undefined)
    try {
      const result = await muse.assignNextAvailableProxy(accountId)
      if (!result.assigned) {
        setError(
          result.removed > 0
            ? `探测 ${result.probed} 个空闲节点、剔除 ${result.removed} 个失效节点，仍没有可用节点；请到「设置 → 代理池与自动分配」同步或导入节点后再试`
            : '代理池里没有未被占用的节点；请到「设置 → 代理池与自动分配」同步或导入节点后再试'
        )
        await refreshPool()
        return
      }
      await Promise.all([refresh(), refreshPool()])
      setSelectedPoolId('')
      setHint(
        `已自动分配并生效：${result.view.mode}://${result.view.host ?? ''}:${result.view.port ?? ''}` +
          ` · 探测 ${result.probed} 个${result.removed > 0 ? ` · 剔除失效节点 ${result.removed} 个` : ''}` +
          (platformId === 'meta-muse' ? ' · 建议重连 Muse 以完整应用 WSS' : '')
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAssigning(false)
    }
  }

  const test = async () => {
    const muse = getBridge()?.muse
    if (!muse?.testProxy) return
    setTesting(true)
    setError(undefined)
    setTestResult(null)
    try {
      const result = await muse.testProxy(accountId, {
        mode,
        host: host.trim() || undefined,
        port: port.trim() ? Number(port) : undefined,
        username: username.trim() || undefined,
        password: password || undefined
      })
      setTestResult(result)
    } catch (err) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        checkedAt: Date.now()
      })
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    const muse = getBridge()?.muse
    if (!muse?.setProxy) return
    setSaving(true)
    setError(undefined)
    setHint(undefined)
    try {
      const next = await muse.setProxy(accountId, {
        mode,
        host: host.trim() || undefined,
        port: port.trim() ? Number(port) : undefined,
        username: username.trim() || undefined,
        password: password || undefined
      })
      setView(next)
      setPassword('')
      setHint(
        platformId === 'meta-muse'
          ? t('Proxy saved — reconnect Muse to apply WSS fully')
          : '独立代理已加密生效（钥匙串锁定异常时自动阻断直连防泄漏）'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!getBridge()?.muse?.getProxy) {
    return (
      <Section title={t('Account proxy')}>
        <EmptyLine>{t('Proxy settings require the Electron app')}</EmptyLine>
      </Section>
    )
  }

  return (
    <Section
      title={t('Account proxy')}
      action={<RefreshButton loading={loading} onClick={() => void refresh()} />}
    >
      {error && <p className="pb-1 text-[12px] text-status-error">{error}</p>}
      {hint && <p className="pb-1 text-[12px] text-ink-secondary">{hint}</p>}
      <p className="mb-2 flex items-center gap-1 text-[11px] text-ink-muted">
        <ShieldCheck className="size-3 shrink-0 text-status-online-ink" aria-hidden />
        <span>钥匙串加密存储 · 不可读时自动阻断直连</span>
      </p>
      <div className="flex flex-col gap-2">
        {poolItems.length > 0 && (
          <label className="flex flex-col gap-1 text-[12px]">
            <span className="font-medium text-ink">从订阅池选择节点 ({poolItems.length})</span>
            <select
              value={selectedPoolId}
              onChange={(e) => void pickFromPool(e.target.value)}
              disabled={picking}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-[12.5px] text-ink"
            >
              <option value="">-- 手动填写或使用下方模式 --</option>
              {poolItems.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.mode}://{p.host}:{p.port}
                </option>
              ))}
            </select>
          </label>
        )}        <label className="flex flex-col gap-1 text-[12px]">
          <span className="font-medium text-ink">{t('Mode')}</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as MuseProxyMode)}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-[12.5px] text-ink"
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label()}
              </option>
            ))}
          </select>
        </label>
        {mode !== 'direct' && (
          <>
            <div className="grid grid-cols-[1fr_84px] gap-1.5">
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="font-medium text-ink">{t('Host')}</span>
                <TextInput value={host} onChange={(e) => setHost(e.target.value)} placeholder="127.0.0.1" />
              </label>
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="font-medium text-ink">{t('Port')}</span>
                <TextInput value={port} onChange={(e) => setPort(e.target.value)} placeholder="7890" />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-[12px]">
              <span className="font-medium text-ink">{t('Username (optional)')}</span>
              <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </label>
            <label className="flex flex-col gap-1 text-[12px]">
              <span className="font-medium text-ink">
                {t('Password')}
                {view?.hasPassword ? ` · ${t('stored')}` : ''}
              </span>
              <TextInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={view?.hasPassword ? t('Leave blank to keep') : ''}
                autoComplete="new-password"
              />
            </label>
          </>
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" disabled={saving} onClick={() => void save()}>
            {t('Save proxy')}
          </Button>
          <Button size="sm" variant="secondary" disabled={testing || saving || picking} onClick={() => void test()}>
            {testing ? '测速中…' : '测试延迟'}
          </Button>
        </div>
        {testResult && (
          <p className={cn('text-[11.5px]', testResult.ok ? 'text-status-online-ink' : 'text-status-error')}>
            {testResult.ok
              ? `✓ ${testResult.latencyMs ?? '?'} ms${testResult.country ? ` · ${testResult.country}` : ''}${testResult.exitIp ? ` · ${testResult.exitIp}` : ''}`
              : `✗ ${testResult.error ?? '代理连接失败'}`}
          </p>
        )}
        <Button
          size="sm"
          variant="primary"
          disabled={assigning || saving || picking}
          onClick={() => void assignNextAvailable()}
        >
          <Shuffle className="size-3.5" aria-hidden />
          {assigning ? t('Assigning…') : t('Assign an unused available proxy')}
        </Button>
        <p className="text-[10.5px] leading-snug text-ink-muted">
          一键探测代理池，挑一个未被其他账号占用且当前可连通的节点立即替换生效；连不通的节点会自动剔除。
        </p>
      </div>
    </Section>
  )
}
