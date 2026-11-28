import { useState } from 'react'
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { syncHarkPool } from '@/lib/harkPoolSync'

export function HarkPoolImport() {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')

  const sync = async () => {
    setBusy(true)
    setDone('')
    setError('')
    try {
      const result = await syncHarkPool((text) => setDone(text))
      setDone(
        `同步完成: 新增 ${result.added}, 重注入 ${result.refreshed}, 迁移 ${result.moved}, 已存在 ${result.existing}, 失败 ${result.failed}`
      )
    } catch (cause) {
      setDone('')
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(
        message.includes('fetch') || message.includes('Failed')
          ? '连不上 Hark 网关, 先确认 127.0.0.1:8920 在运行'
          : message
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => void sync()}>
        <RefreshCw className={busy ? 'size-3.5 animate-spin' : 'size-3.5'} />
        {busy ? '正在同步...' : '一键同步 Hark 号池'}
      </Button>
      {done && (
        <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
          <CheckCircle2 className="size-3" /> {done}
        </span>
      )}
      {error && (
        <span className="inline-flex items-center gap-1 text-[11px] text-status-error">
          <AlertCircle className="size-3" /> {error}
        </span>
      )}
    </div>
  )
}
