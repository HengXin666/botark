import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  class FakeView {
    webContents: any
    setBackgroundColor = vi.fn()
    setBounds = vi.fn()
    constructor() {
      const contents: any = {
        destroyed: false,
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        loadURL: vi.fn(() => Promise.resolve()),
        isDestroyed: () => contents.destroyed,
        close: vi.fn(() => { contents.destroyed = true })
      }
      this.webContents = contents
    }
  }
  return {
    session: { fromPartition: vi.fn(() => ({ clearStorageData: vi.fn(), clearCache: vi.fn() })) },
    shell: { openExternal: vi.fn() },
    WebContentsView: FakeView
  }
})

import { WebContentsViewManager } from './webContentsViewManager'

function fakeWindow() {
  return {
    webContents: { on: vi.fn() },
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    on: vi.fn(),
    isDestroyed: () => false
  } as never
}

describe('WebContentsViewManager LRU', () => {
  let manager: WebContentsViewManager
  beforeEach(() => {
    manager = new WebContentsViewManager(fakeWindow())
  })

  it('does not destroy the next view when attaching after a detach', () => {
    const first = manager.create({ botId: 'b1', accountId: 'a1', label: 'A' })
    const second = manager.create({ botId: 'b1', accountId: 'a2', label: 'B' })
    manager.attach(first.viewId, { x: 0, y: 0, width: 10, height: 10 })
    manager.attach(second.viewId, { x: 0, y: 0, width: 10, height: 10 })
    const view = manager.getView(second.viewId) as any
    expect(view).toBeDefined()
    expect(view.webContents.destroyed).toBe(false)
  })

  it('keeps at most one warm detached view', () => {
    const a = manager.create({ botId: 'b1', accountId: 'a1', label: 'A' })
    const b = manager.create({ botId: 'b1', accountId: 'a2', label: 'B' })
    const c = manager.create({ botId: 'b1', accountId: 'a3', label: 'C' })
    manager.attach(a.viewId, { x: 0, y: 0, width: 10, height: 10 })
    manager.attach(b.viewId, { x: 0, y: 0, width: 10, height: 10 })
    manager.attach(c.viewId, { x: 0, y: 0, width: 10, height: 10 })
    const visible = manager.getView(c.viewId) as any
    expect(visible.webContents.destroyed).toBe(false)
  })
})
