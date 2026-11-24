import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { MobileSyncStateView } from '@shared/mobileSync'
import {
  Check,
  Copy,
  Download,
  Lock,
  Power,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  Wifi
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { getBridge } from '@/lib/bridge'
import { cn } from '@/lib/cn'

function formatTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function MobileSyncSettingsPanel() {
  const [state, setState] = useState<MobileSyncStateView | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [copiedKey, setCopiedKey] = useState<'uri' | 'bundle' | null>(null)
  const [exportedBundle, setExportedBundle] = useState<{
    filePath: string
    transferKey: string
    fingerprint: string
  } | null>(null)
  const [error, setError] = useState<string>()

  const loadState = useCallback(async () => {
    const sync = getBridge()?.mobileSync
    if (!sync) return
    try {
      const next = await sync.getState()
      setState(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    const sync = getBridge()?.mobileSync
    if (!sync) return
    void loadState()
    return sync.onStateChanged((next) => setState(next))
  }, [loadState])

  // Render crisp high-contrast QR code whenever pairUri rotates
  useEffect(() => {
    let cancelled = false
    if (!state?.pairUri) {
      setQrDataUrl('')
      return
    }
    void QRCode.toDataURL(state.pairUri, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 260,
      color: { dark: '#0f172a', light: '#ffffff' }
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('')
      })
    return () => {
      cancelled = true
    }
  }, [state?.pairUri])

  const handleStartOrStop = async () => {
    const sync = getBridge()?.mobileSync
    if (!sync) return
    setBusy(true)
    setError(undefined)
    try {
      const next = state?.running ? await sync.stop() : await sync.start()
      setState(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRotate = async () => {
    const sync = getBridge()?.mobileSync
    if (!sync) return
    setBusy(true)
    try {
      setState(await sync.rotatePairing())
    } finally {
      setBusy(false)
    }
  }

  const handleToggleDirectCreds = async (enabled: boolean) => {
    const sync = getBridge()?.mobileSync
    if (!sync) return
    setState(await sync.setIncludeDirectCredentials(enabled))
  }

  const handleRevoke = async (deviceId: string) => {
    const sync = getBridge()?.mobileSync
    if (!sync) return
    setState(await sync.revokeDevice(deviceId))
  }

  const handleExportOfflineBundle = async () => {
    const sync = getBridge()?.mobileSync
    if (!sync) return
    setBusy(true)
    setError(undefined)
    try {
      const res = await sync.exportOfflineBundle()
      if (!res.canceled) {
        setExportedBundle({
          filePath: res.filePath,
          transferKey: res.transferKey,
          fingerprint: res.fingerprint
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const copyText = (text: string, kind: 'uri' | 'bundle') => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(kind)
      setTimeout(() => setCopiedKey((cur) => (cur === kind ? null : cur)), 1800)
    })
  }

  return (
    <div className="flex flex-col gap-5 animate-veil-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-ink">手机端无服务器扫码同步</h2>
          <p className="mt-0.5 text-[13px] text-ink-secondary">
            零云端服务器、纯端到端加密：Android / iPhone 与电脑在同一 Wi-Fi / 热点 / Tailscale 下扫码即同步全部 5 大平台助手、分组、实时对话与可用代理节点，也支持导出加密同步包离线导入。
          </p>
        </div>
        <Button
          size="sm"
          variant={state?.running ? 'secondary' : 'primary'}
          disabled={busy}
          onClick={() => void handleStartOrStop()}
        >
          <Power className="size-3.5" />
          {state?.running ? '停止本地同步桥' : '开启扫码配对'}
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-status-error/30 bg-status-error/8 px-3.5 py-2.5 text-[12.5px] text-status-error">
          {error}
        </div>
      )}

      {/* Main QR Card */}
      <div className="grid gap-4 rounded-2xl border border-line bg-surface p-5 shadow-soft md:grid-cols-[260px_1fr]">
        <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-main p-4">
          {state?.running && qrDataUrl ? (
            <>
              <img
                src={qrDataUrl}
                alt="BotArk 手机端配对二维码"
                className="size-[220px] rounded-xl bg-white p-1.5 shadow-sm"
              />
              <div className="mt-2.5 flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 font-mono text-[11.5px] text-ink">
                <ShieldCheck className="size-3.5 text-status-online" />
                <span>校验指纹 {state.fingerprint}</span>
              </div>
            </>
          ) : (
            <div className="flex h-[220px] flex-col items-center justify-center gap-3 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-hover text-ink-muted">
                <QrCode className="size-7" />
              </div>
              <p className="max-w-[190px] text-[12.5px] leading-[18px] text-ink-secondary">
                点击「开启扫码配对」，立即在局域网生成一次性加密配对二维码
              </p>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void handleStartOrStop()}>
                开启扫码配对
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-col justify-between gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium',
                  state?.running
                    ? 'bg-status-online/12 text-status-online-ink'
                    : 'bg-hover text-ink-muted'
                )}
              >
                <Wifi className="size-3" />
                {state?.running ? `本地同步桥运行中 · 端口 ${state.port}` : '本地同步桥未启动'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-hover px-2.5 py-0.5 text-[11.5px] text-ink-secondary">
                <Lock className="size-3" />
                AES-256-GCM · 零云端中转
              </span>
            </div>

            <ol className="space-y-1.5 text-[12.5px] leading-[19px] text-ink-secondary">
              <li>
                <strong className="text-ink">1.</strong> 在手机上打开原生 <strong className="text-ink">BotArk</strong> App（Android 源码位于仓库 <code className="font-mono text-[11.5px]">android/BotArk</code>，iOS 位于 <code className="font-mono text-[11.5px]">ios/BotArk</code>）
              </li>
              <li>
                <strong className="text-ink">2.</strong> 点击右上角「扫码配对」扫描左侧二维码（单次有效，扫码后自动轮换）
              </li>
              <li>
                <strong className="text-ink">3.</strong> 全部 Grok Bot、Meta Muse、ChatGPT Dot、Hark 与 Hermes 助手、历史消息与审批卡片瞬间同步，支持实时流式对话与远程审批
              </li>
            </ol>

            {state?.running && state.hosts.length > 0 && (
              <div className="rounded-xl border border-line bg-main px-3 py-2">
                <p className="text-[11px] font-medium text-ink-muted">本机可发现地址（Wi-Fi 局域网 / Tailscale 自动并行探测）</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {state.hosts.map((ip) => (
                    <span
                      key={ip}
                      className="rounded bg-surface px-2 py-0.5 font-mono text-[11px] text-ink ring-1 ring-line"
                    >
                      {ip}:{state.port}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <label className="flex items-start gap-2.5 rounded-xl border border-line bg-main px-3 py-2.5 text-[12px] text-ink-secondary">
              <input
                type="checkbox"
                checked={state?.includeDirectCredentials ?? true}
                onChange={(e) => void handleToggleDirectCreds(e.target.checked)}
                className="mt-0.5 rounded border-line"
              />
              <span>
                <strong className="text-ink">同步可脱机直连的 Hermes / Hark 凭据（AES-256-GCM 端到端加密）</strong>
                <span className="block text-[11.5px] text-ink-muted">
                  二维码只负责同步账号、分组消息和登录凭据。开启后会把已配置的 Hermes API Server 地址与密钥、Hark 账号 Cookie 用一次性密钥加密传至手机 Keystore；之后即使电脑关机，手机端也能直接连接远程 Hermes 或 Hark。
                </span>
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {state?.running && (
              <>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleRotate()}>
                  <RefreshCw className="size-3.5" />
                  刷新一次性二维码
                </Button>
                {state.pairUri && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copyText(state.pairUri!, 'uri')}
                  >
                    {copiedKey === 'uri' ? <Check className="size-3.5 text-status-online" /> : <Copy className="size-3.5" />}
                    {copiedKey === 'uri' ? '已复制配对链接' : '复制配对链接'}
                  </Button>
                )}
              </>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void handleExportOfflineBundle()}
            >
              <Download className="size-3.5" />
              导出加密 AirDrop 同步包 (.botark-sync)
            </Button>
          </div>
        </div>
      </div>

      {/* Offline AirDrop Export Result */}
      {exportedBundle && (
        <div className="rounded-2xl border border-status-online/30 bg-status-online/8 p-4 text-[12.5px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-status-online-ink">
              已生成加密同步包（校验指纹 {exportedBundle.fingerprint}）
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => copyText(exportedBundle.transferKey, 'bundle')}
            >
              {copiedKey === 'bundle' ? <Check className="size-3.5 text-status-online" /> : <Copy className="size-3.5" />}
              {copiedKey === 'bundle' ? '已复制解密密钥' : '复制一次性解密密钥'}
            </Button>
          </div>
          <p className="mt-1 break-all font-mono text-[11px] text-ink-secondary">{exportedBundle.filePath}</p>
          <p className="mt-1.5 text-[11.5px] text-ink-secondary">
            通过 AirDrop / 文件传输发送此文件到手机并在 BotArk 手机端选择导入，粘贴上方解密密钥即可完全离线同步，无需同一 Wi-Fi！
          </p>
        </div>
      )}

      {/* Paired iOS Devices */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-ink">
            已授权的手机设备（{state?.devices.length ?? 0}）
          </h3>
          {(state?.devices.length ?? 0) > 0 && (
            <Button size="sm" variant="ghost" onClick={() => void handleRevoke('*')}>
              全部取消授权
            </Button>
          )}
        </div>

        {!state || state.devices.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-surface/50 px-6 py-8 text-center text-[12.5px] text-ink-muted">
            暂无已配对的手机设备。开启上方同步桥并用 BotArk 手机端扫码即可自动出现在这里。
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
            <ul className="divide-y divide-line">
              {state.devices.map((dev) => (
                <li key={dev.deviceId} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-xl',
                        dev.connected ? 'bg-status-online/15 text-status-online' : 'bg-hover text-ink-muted'
                      )}
                    >
                      <Smartphone className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-[13.5px] font-semibold text-ink">
                        <span className="truncate">{dev.deviceName}</span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10.5px] font-medium',
                            dev.connected
                              ? 'bg-status-online/15 text-status-online-ink'
                              : 'bg-hover text-ink-muted'
                          )}
                        >
                          {dev.connected ? '实时在线' : '离线'}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                        {dev.deviceModel || 'iOS'} · 最近同步 {formatTime(dev.lastSeenAtMs)}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleRevoke(dev.deviceId)}
                    title="移除该设备授权"
                  >
                    <Trash2 className="size-3.5 text-status-error" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
