import { useCallback, useEffect, useState } from 'react'
import { Copy, KeyRound, Plus, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react'
import type { ApiKeyAuditEntry, ApiKeyCreateResult, ApiKeyView } from '@shared/apiKeys'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { getBridge } from '@/lib/bridge'

function formatTime(ms: number | null): string {
  if (!ms) return '从未'
  return new Date(ms).toLocaleString()
}

function formatTokens(key: ApiKeyView): string {
  const prefix = key.estimatedTokens ? '≈ ' : ''
  return prefix + key.totalTokens.toLocaleString()
}

export function ApiKeysSection() {
  const api = getBridge()?.apiKeys
  const [keys, setKeys] = useState<ApiKeyView[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [name, setName] = useState('')
  const [created, setCreated] = useState<ApiKeyCreateResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [auditKey, setAuditKey] = useState<ApiKeyView | null>(null)
  const [audit, setAudit] = useState<ApiKeyAuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!api) return
    setLoading(true)
    setError(undefined)
    try {
      setKeys(await api.list())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleCreate = async (): Promise<void> => {
    if (!api || !name.trim()) return
    setError(undefined)
    try {
      const result = await api.create(name.trim())
      setCreated(result)
      setName('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRevoke = async (key: ApiKeyView): Promise<void> => {
    if (!api || key.revokedAtMs) return
    if (!window.confirm('撤销后该密钥会立即失效，且无法恢复。继续？')) return
    try {
      await api.revoke(key.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleAudit = async (key: ApiKeyView): Promise<void> => {
    if (!api) return
    setAuditKey(key)
    setAuditLoading(true)
    setAudit([])
    try {
      setAudit(await api.audit(key.id, 100))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAuditLoading(false)
    }
  }

  const copyToken = async (): Promise<void> => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.token)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  if (!api) {
    return <div className="rounded-2xl border border-line bg-surface p-5 text-[13px] text-ink-secondary">当前运行环境不支持 API 密钥管理。</div>
  }

  return (
    <div className="flex flex-col gap-5 animate-veil-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">API 密钥、审计与 Token 统计</h2>
          <p className="mt-1 max-w-[680px] text-[13px] leading-5 text-ink-secondary">
            这里生成的永久密钥供手机 App 或外部脚本使用。完整密钥只在创建时显示一次；服务端只保存 SHA-256 哈希，可随时撤销。
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} /> 刷新
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-status-error/25 bg-status-error/8 px-3.5 py-2.5 text-[13px] text-status-error">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
        <div className="flex items-center gap-2 text-[14px] font-medium text-ink">
          <KeyRound className="size-4" /> 新建永久密钥
        </div>
        <p className="mt-1 text-[12px] text-ink-muted">建议按客户端/人分别创建，撤销时互不影响。密钥只会显示一次。</p>
        <div className="mt-3 flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreate()
            }}
            maxLength={64}
            placeholder="例如：我的 iPhone"
            className="h-9 min-w-0 flex-1 rounded-xl border border-line bg-main px-3 text-[13px] text-ink outline-none focus:border-accent-600"
          />
          <Button size="md" variant="primary" onClick={() => void handleCreate()} disabled={!name.trim()}>
            <Plus /> 生成
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
        <div className="grid grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_0.7fr_auto] gap-3 border-b border-line px-4 py-2.5 text-[11px] font-medium text-ink-muted max-lg:grid-cols-[1.2fr_0.8fr_0.6fr_0.6fr_auto] max-sm:hidden">
          <span>名称 / 前缀</span><span>状态</span><span>最近使用</span><span>请求数</span><span>Token（估算）</span><span />
        </div>
        {keys.length === 0 && !loading && (
          <div className="px-4 py-10 text-center text-[13px] text-ink-muted">还没有 API 密钥。创建后，外部客户端即可用 Bearer 密钥接入。</div>
        )}
        {keys.map((key) => (
          <div key={key.id} className="grid grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_0.7fr_auto] items-center gap-3 border-b border-line/70 px-4 py-3 text-[12px] last:border-0 max-lg:grid-cols-[1.2fr_0.8fr_0.6fr_0.6fr_auto] max-sm:grid-cols-1 max-sm:gap-1">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-ink">{key.name}</p>
              <p className="mt-0.5 font-mono text-[11px] text-ink-muted">{key.prefix}…</p>
            </div>
            <span className={key.revokedAtMs ? 'text-status-error' : 'text-status-online-ink'}>
              {key.revokedAtMs ? '已撤销' : '生效中'}
            </span>
            <span className="text-ink-secondary">{formatTime(key.lastUsedAtMs)}</span>
            <span className="tabular-nums text-ink-secondary">{key.requestCount.toLocaleString()}</span>
            <span className="tabular-nums text-ink-secondary" title={key.estimatedTokens ? '平台未返回精确 usage，按文本长度估算' : undefined}>
              {formatTokens(key)}
            </span>
            <div className="flex justify-end gap-1 max-sm:justify-start">
              <Button size="sm" variant="ghost" onClick={() => void handleAudit(key)}>
                审计
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={Boolean(key.revokedAtMs)}
                onClick={() => void handleRevoke(key)}
              >
                <Trash2 /> 撤销
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-[12px] leading-5 text-ink-secondary">
        Token 统计优先使用平台返回的 usage；平台不提供时按文本长度做保守估算，并在数字前加 ≈。
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3.5 py-2.5 text-[12px] leading-5 text-ink-secondary">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <span>密钥是服务器级管理员凭据，等同于完整工作区访问权限。不要把完整密钥写入前端代码、URL 或日志；怀疑泄露时立即撤销并新建。</span>
      </div>

      <Dialog
        open={created !== null}
        onOpenChange={(open) => {
          if (!open) setCreated(null)
        }}
        title="密钥已生成"
        footer={
          <Button variant="primary" onClick={() => setCreated(null)}>
            我已保存
          </Button>
        }
      >
        {created && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-5 text-ink-secondary">
              这是密钥 <strong>{created.key.name}</strong> 的完整值，只显示这一次。请立即复制到安全位置。
            </p>
            <code className="break-all rounded-xl border border-line bg-sunken px-3 py-2.5 font-mono text-[12px] text-ink">
              {created.token}
            </code>
            <Button size="sm" variant="secondary" onClick={() => void copyToken()}>
              <Copy /> {copied ? '已复制' : '复制完整密钥'}
            </Button>
          </div>
        )}
      </Dialog>

      <Dialog
        open={auditKey !== null}
        onOpenChange={(open) => {
          if (!open) setAuditKey(null)
        }}
        title={auditKey ? '审计日志 · ' + auditKey.name : '审计日志'}
        className="w-[min(94vw,760px)]"
      >
        <div className="flex flex-col gap-3">
          <p className="text-[12px] text-ink-muted">最近 100 条请求，倒序显示。Token 为估算值时以 ≈ 标记。</p>
          {auditLoading && <p className="text-[13px] text-ink-muted">加载中…</p>}
          {!auditLoading && audit.length === 0 && <p className="text-[13px] text-ink-muted">暂无请求记录。</p>}
          <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-line">
            {audit.map((entry) => (
              <div key={entry.id} className="flex items-start justify-between gap-3 border-b border-line/70 px-3 py-2.5 text-[12px] last:border-0">
                <div className="min-w-0">
                  <p className="font-mono text-ink">
                    {entry.method} {entry.path}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-muted">
                    {formatTime(entry.atMs)} · {entry.statusCode} · {entry.durationMs}ms
                    {entry.accountId ? ' · account=' + entry.accountId : ''}
                    {entry.botId ? ' · bot=' + entry.botId : ''}
                  </p>
                </div>
                {typeof entry.tokens === 'number' && <span className="shrink-0 tabular-nums text-ink-secondary">≈{entry.tokens}</span>}
              </div>
            ))}
          </div>
        </div>
      </Dialog>
    </div>
  )
}
