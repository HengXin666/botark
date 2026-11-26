import { expect, it } from 'vitest'
import { currentHarkBrowser, harkScreenshotReference } from './harkBrowserPreview'

it('prefers an asset key and supports a direct Hark screenshot when no key is available', () => {
  const panel = { kind: 'browser', status: 'active', screenshotUrl: '/api/images/frame' }
  expect(currentHarkBrowser([panel])?.screenshotUrl).toBe('https://app.hark.com/api/images/frame')
  expect(currentHarkBrowser([{ ...panel, screenshotKey: 'screens/frame' }])).toMatchObject({
    screenshotKey: 'screens/frame', screenshotUrl: undefined
  })
})

it('discards URL-shaped storage keys and direct screenshot URLs with user info', () => {
  expect(harkScreenshotReference(' https://example.test/screenshot ', 'https://user@app.hark.com/frame'))
    .toEqual({ screenshotKey: undefined, screenshotUrl: undefined })
})
it('keeps page and live-view addresses as metadata rather than image sources', () => {
  const panel = { kind: 'browser', status: 'active', url: 'https://example.com',
    liveViewUrl: 'https://example.com/live', screenshotUrl: 'https://example.com/frame' }
  expect(currentHarkBrowser([panel])).toMatchObject({ label: panel.url, screenshotUrl: undefined })
})
