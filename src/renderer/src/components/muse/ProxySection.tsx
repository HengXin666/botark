import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { MuseProxyMode, MuseProxyView } from '@shared/ipc'
import { EmptyLine, Section } from '@/components/info/Section'
import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/Field'
import { RefreshButton } from '@/components/muse/RefreshButton'
import { getBridge } from '@/lib/bridge'
import { t } from '@/lib/i18n'
import { useBotStore } from '@/store/botStore'

const MODES: Array<{ value: MuseProxyMode; label: () => string }> = [
  { value: 'direct', label: () => t('Direct (no proxy)') },
  { value: 'http', label: () => t('HTTP proxy') },
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

  useEffect(() => {
    const muse = getBridge()?.muse
    if (!muse?.listProxyPool) return
    void muse.listProxyPool().then((items) => {
      setPoolItems(items.map((i) => ({ id: i.id, mode: i.mode, host: i.host, port: i.port })))
    }).catch(() => undefined)
  }, [])

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
        <Button size="sm" variant="secondary" disabled={saving} onClick={() => void save()}>
          {t('Save proxy')}
        </Button>
      </div>
    </Section>
  )
}
