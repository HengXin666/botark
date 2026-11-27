import { useState, type FormEvent } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'

type Status = { kind: 'idle' | 'ok' | 'error'; text: string }

/**
 * Change the Web gateway administrator password from the browser.
 *
 * The gateway accepts the change only with the current password, writes the
 * new scrypt hash to the persistent data volume, and revokes every other
 * browser session.  This component is rendered only in the Web runtime.
 */
export function WebPasswordSettings() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' })

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (next.length < 8) {
      setStatus({ kind: 'error', text: '新密码至少需要 8 个字符' })
      return
    }
    if (next !== confirm) {
      setStatus({ kind: 'error', text: '两次输入的新密码不一致' })
      return
    }
    setBusy(true)
    setStatus({ kind: 'idle', text: '' })
    try {
      const response = await fetch('/api/web/v1/password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next })
      })
      const data = (await response.json().catch(() => ({}))) as { message?: string }
      if (!response.ok) {
        setStatus({ kind: 'error', text: data.message || '修改失败，请重试' })
        return
      }
      setCurrent('')
      setNext('')
      setConfirm('')
      setStatus({ kind: 'ok', text: '密码已修改；其他已登录浏览器已被退出。' })
    } catch {
      setStatus({ kind: 'error', text: '网络错误，请重试' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-600/10 text-accent-600">
          <KeyRound className="size-4" />
        </span>
        <div>
          <h3 className="text-[14px] font-semibold text-ink">Web 管理员密码</h3>
          <p className="mt-1 text-[12px] leading-5 text-ink-secondary">
            修改后立即生效，并保存在服务端持久化数据卷中；其他浏览器会话会被退出。
          </p>
        </div>
      </div>
      <form className="mt-4 grid gap-3 sm:grid-cols-3" onSubmit={(event) => void submit(event)}>
        <label className="grid gap-1.5 text-[12px] text-ink-secondary">
          当前密码
          <input
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
            className="h-9 rounded-xl border border-line bg-canvas px-3 text-[13px] text-ink outline-none focus:border-accent-600"
          />
        </label>
        <label className="grid gap-1.5 text-[12px] text-ink-secondary">
          新密码
          <input
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            className="h-9 rounded-xl border border-line bg-canvas px-3 text-[13px] text-ink outline-none focus:border-accent-600"
          />
        </label>
        <label className="grid gap-1.5 text-[12px] text-ink-secondary">
          确认新密码
          <input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            className="h-9 rounded-xl border border-line bg-canvas px-3 text-[13px] text-ink outline-none focus:border-accent-600"
          />
        </label>
        <div className="flex items-end gap-2 sm:col-span-3">
          <Button type="submit" size="sm" variant="primary" disabled={busy || !current || !next || !confirm}>
            <ShieldCheck /> {busy ? '保存中…' : '修改密码'}
          </Button>
          {status.kind !== 'idle' && (
            <span className={status.kind === 'ok' ? 'text-[12px] text-status-online-ink' : 'text-[12px] text-status-error'}>
              {status.text}
            </span>
          )}
        </div>
      </form>
    </div>
  )
}
