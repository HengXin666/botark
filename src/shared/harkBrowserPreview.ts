export interface HarkBrowserPreview {
  label: string
  status: string
  screenshotKey?: string
  screenshotUrl?: string
}

export const HARK_PREVIEW_MAX_BYTES = 8 * 1024 * 1024
export const HARK_PREVIEW_TIMEOUT_MS = 12_000

interface Panel {
  kind: string
  status: string
  title?: string
  url?: string
  liveViewUrl?: string
  screenshotKey?: string
  screenshotUrl?: string
}

export function currentHarkBrowser(panels: Panel[]): HarkBrowserPreview | null {
  let panel: Panel | undefined
  for (let index = panels.length - 1; index >= 0; index--) {
    const candidate = panels[index]!
    if (!candidate.screenshotKey && !candidate.screenshotUrl && !candidate.liveViewUrl && !/browser|computer/i.test(candidate.kind)) continue
    panel ??= candidate
    if (/^(active|running|pending|started|waiting_for_input)$/i.test(candidate.status)) {
      panel = candidate
      break
    }
  }
  if (!panel) return null
  return {
    label: panel.url || panel.title || panel.kind, status: panel.status,
    ...harkScreenshotReference(panel.screenshotKey, panel.screenshotUrl)
  }
}

export function harkScreenshotReference(key?: string, directUrl?: string): Pick<HarkBrowserPreview, 'screenshotKey' | 'screenshotUrl'> {
  const cleanKey = key?.trim()
  const screenshotKey = cleanKey && !/^(?:[a-z][a-z0-9+.-]*:|[/\\])/i.test(cleanKey) ? cleanKey : undefined
  let screenshotUrl: string | undefined
  if (!screenshotKey && directUrl && URL.canParse(directUrl, 'https://app.hark.com')) {
    const url = new URL(directUrl, 'https://app.hark.com')
    if (url.protocol === 'https:' && !url.username && !url.password &&
      (url.hostname === 'hark.com' || url.hostname.endsWith('.hark.com'))) screenshotUrl = url.href
  }
  return { screenshotKey, screenshotUrl }
}
