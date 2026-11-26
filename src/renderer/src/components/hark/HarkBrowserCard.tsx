import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Monitor } from 'lucide-react'
import { harkRpc } from '@adapters/hark/harkRequests'
import type { HarkBrowserPreview } from '@shared/harkBrowserPreview'
import { createId } from '@shared/id'
import { RefreshButton } from '@/components/muse/RefreshButton'
import { getBridge } from '@/lib/bridge'
import { useHarkScreenshot } from './HarkScreenshot'

export function HarkBrowserCard({ accountId, sessionId }: { accountId: string; sessionId?: string }) {
  return <HarkBrowserPreviewCard key={JSON.stringify([accountId, sessionId])} accountId={accountId} sessionId={sessionId} />
}

function HarkBrowserPreviewCard({ accountId, sessionId }: { accountId: string; sessionId?: string }) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<HarkBrowserPreview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const streamRevision = useRef(0)
  const snapshotRequest = useRef<AbortController | null>(null)
  const hark = getBridge()?.hark

  useEffect(() => hark?.onEvent((event) => {
    if (event.type === 'projectHistory' && event.accountId === accountId && event.conversationId === sessionId
      && event.browserPreview !== undefined) {
      streamRevision.current++
      snapshotRequest.current?.abort()
      setLoading(false)
      setError('')
      setPanel(event.browserPreview)
    }
  }), [hark, accountId, sessionId])

  useEffect(() => {
    if (!open || !hark) return
    const request = new AbortController()
    snapshotRequest.current = request
    const before = streamRevision.current
    setLoading(true)
    setError('')
    void harkRpc(hark, { accountId, op: 'browserPreview', conversationId: sessionId, requestId: createId('hark_preview') }, request.signal).then((res) => {
      if (request.signal.aborted || before !== streamRevision.current) return
      if (!res.ok) throw new Error(res.message)
      setPanel(res.data as HarkBrowserPreview | null)
    }).catch((err) => {
      if (!request.signal.aborted) setError(err instanceof Error ? err.message : String(err))
    }).finally(() => { if (!request.signal.aborted) setLoading(false) })
    return () => {
      request.abort()
      if (snapshotRequest.current === request) snapshotRequest.current = null
    }
  }, [open, hark, accountId, sessionId, revision])

  const key = panel?.screenshotKey
  const url = panel?.screenshotUrl
  const screenshot = useHarkScreenshot(accountId, { enabled: open, key, url, generation: JSON.stringify([sessionId, revision]) })
  const image = screenshot?.image

  if (!hark) return null
  return (
    <section className="mx-5 mb-1 shrink-0 rounded-xl border border-line bg-surface px-3 text-[12px]">
      <div className="flex items-center gap-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-ink-secondary">
          <Monitor className="size-4 shrink-0" /><span className="shrink-0">远程浏览器</span>
          <span className="truncate">{panel?.label}</span>
          <ChevronDown className={open ? 'ml-auto size-4 rotate-180' : 'ml-auto size-4'} />
        </button>
        {open && <RefreshButton loading={loading} onClick={() => setRevision((r) => r + 1)} />}
      </div>
      {open && <div className="pb-2">
        {image && <img src={image} alt="Hark 远程浏览器截图" className="max-h-[24vh] w-full rounded-lg bg-sunken object-contain" />}
        <p className="truncate text-ink-muted" role="status">{error || screenshot?.error || (loading ? '正在刷新…' : panel
          ? panel.status + (image ? '' : key || url ? ' · 正在加载截图…' : ' · 暂无截图')
          : '当前对话暂无浏览器任务')}</p>
      </div>}
    </section>
  )
}
