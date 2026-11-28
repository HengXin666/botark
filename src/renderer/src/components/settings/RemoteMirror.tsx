import { useEffect, useState } from 'react'
import { getBridge } from '@/lib/bridge'
import { AlertCircle, CheckCircle2, ServerCog } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  loadMirrorSettings,
  mirrorWorkspaceToVps,
  saveMirrorSettings,
  type RemoteMirrorSettings
} from '@/lib/remoteMirror'

function humanError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/fetch|Failed|ECONNREFUSED/i.test(message)) return '连不上目标服务, 检查地址与本地网关 8920'
  return message
}

/** One-click: push local group names, bot names and assignments to the BotArk VPS. */
export function RemoteMirror() {
  const [settings, setSettings] = useState<RemoteMirrorSettings>({ url: '', token: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const saved = loadMirrorSettings()
    setSettings(saved)
    if (saved.url) return
    const bridge = getBridge()?.hark
    if (!bridge?.mirrorSettings) return
    void bridge
      .mirrorSettings()
      .then((preloaded) => {
        if (!preloaded.url || !preloaded.token) return
        saveMirrorSettings(preloaded)
        setSettings(preloaded)
      })
      .catch(() => undefined)
  }, [])

  const persist = (next: RemoteMirrorSettings): void => {
    setSettings(next)
    saveMirrorSettings(next)
  }

  const sync = async (): Promise<void> => {
    setBusy(true)
    setDone('')
    setError('')
    try {
      const result = await mirrorWorkspaceToVps((text) => setDone(text))
      setDone(
        `已同步 ${result.bots} 个 bot / ${result.groups} 个分组, 新导入 ${result.imported}, 失败 ${result.failed}`
      )
      if (result.failed > 0) setError('有账号缺 session_token 或远端拒绝, 见 VPS 账号列表')
    } catch (cause) {
      setDone('')
      setError(humanError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-[13px] font-medium text-ink">同步到 VPS BotArk</span>
          <p className="mt-0.5 text-[11px] text-ink-secondary">
            把本地分组名, bot 名称和归属推给远端; 缺失的会话从 Hark 网关导入.
          </p>
        </div>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void sync()}>
          <ServerCog className={busy ? 'size-3.5 animate-spin' : 'size-3.5'} />
          {busy ? '正在同步...' : '一键同步到 VPS'}
        </Button>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        <input
          value={settings.url}
          onChange={(event) => persist({ ...settings, url: event.target.value })}
          placeholder="https://botark.example.com"
          spellCheck={false}
          className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 font-mono text-[12px] text-ink"
        />
        <input
          value={settings.token}
          onChange={(event) => persist({ ...settings, token: event.target.value })}
          placeholder="bk_... (设置与账号 -> API 密钥与审计)"
          spellCheck={false}
          type="password"
          className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 font-mono text-[12px] text-ink"
        />
      </div>
      {done && (
        <span className="mt-2 inline-flex items-center gap-1 text-[11px] text-ink-muted">
          <CheckCircle2 className="size-3" /> {done}
        </span>
      )}
      {error && (
        <span className="mt-2 inline-flex items-center gap-1 text-[11px] text-status-error">
          <AlertCircle className="size-3" /> {error}
        </span>
      )}
    </div>
  )
}