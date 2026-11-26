import { useEffect, useState } from 'react'
import { harkRpc } from '@adapters/hark/harkRequests'
import { createId } from '@shared/id'
import { getBridge } from '@/lib/bridge'

type Screenshot = { generation: string; image?: string; error?: string }
const pendingScreenshots = new Map<string, { promise: Promise<string>; controller: AbortController; users: number }>()

export function useHarkScreenshot(accountId: string, options: {
  enabled?: boolean; key?: string; url?: string; generation: number | string
}) {
  const { enabled = true, key, url, generation: revision } = options
  const [screenshot, setScreenshot] = useState<Screenshot>()
  const generation = JSON.stringify([accountId, key, url, revision])
  useEffect(() => {
    setScreenshot(undefined)
    const hark = getBridge()?.hark
    if (!enabled || !hark || (!key && !url)) return
    let active = true
    let request = pendingScreenshots.get(generation)
    if (!request) {
      const controller = new AbortController()
      const promise = harkRpc(hark, {
        accountId, op: 'downloadArtifact', requestId: createId('hark_screenshot'), preview: true,
        fileId: key, url: key ? undefined : url
      }, controller.signal).then((res) => {
        if (!res.ok) throw new Error(res.message)
        const data = res.data as { mimeType: string; dataBase64: string }
        if (!data?.mimeType?.startsWith('image/') || !data.dataBase64) throw new Error('截图不可用')
        return `data:${data.mimeType};base64,${data.dataBase64}`
      }).finally(() => {
        if (pendingScreenshots.get(generation)?.controller === controller) pendingScreenshots.delete(generation)
      })
      pendingScreenshots.set(generation, (request = { controller, promise, users: 0 }))
    }
    request.users++
    void request.promise.then((image) => {
      if (active) setScreenshot({ generation, image })
    }, (error) => {
      if (active) setScreenshot({ generation, error: error instanceof Error ? error.message : String(error) })
    })
    return () => {
      active = false
      if (--request.users === 0 && pendingScreenshots.get(generation) === request) {
        pendingScreenshots.delete(generation)
        request.controller.abort()
      }
    }
  }, [enabled, accountId, key, url, generation])

  return enabled && screenshot?.generation === generation ? screenshot : undefined
}

export function HarkScreenshot({ accountId, screenshotKey, screenshotUrl, generation, alt, className }: {
  accountId: string; screenshotKey?: string; screenshotUrl?: string; generation: number | string;
  alt: string; className: string
}) {
  const screenshot = useHarkScreenshot(accountId, { key: screenshotKey, url: screenshotUrl, generation })
  if (screenshot?.error) return <p className="text-ink-muted">{screenshot.error}</p>
  return screenshot?.image ? <img src={screenshot.image} alt={alt} className={className} /> : null
}
