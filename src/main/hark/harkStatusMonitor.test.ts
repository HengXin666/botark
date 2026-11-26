import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  statuses: vi.fn(),
  list: vi.fn(),
  notifications: [] as Array<{ title?: string; body?: string }>,
  supported: true
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {
    static isSupported(): boolean {
      return hoisted.supported
    }
    constructor(options: { title?: string; body?: string }) {
      hoisted.notifications.push(options)
    }
    on(): this {
      return this
    }
    show(): void {}
  }
}))

vi.mock('./harkClient', () => ({
  getConversationStatuses: hoisted.statuses,
  listConversations: hoisted.list
}))

import {
  getHarkWatchDiagnostics,
  HARK_LIVE_WATCH_LIMIT,
  onHarkStatusEvent,
  touchHarkStatuses,
  unwatchAllHarkStatuses,
  watchHarkStatuses,
  type HarkConversationStatusEvent
} from './harkStatusMonitor'

beforeEach(() => {
  vi.useFakeTimers()
  hoisted.statuses.mockReset()
  hoisted.list.mockReset()
  hoisted.notifications.length = 0
  hoisted.supported = true
  unwatchAllHarkStatuses()
})

afterEach(() => {
  unwatchAllHarkStatuses()
  vi.useRealTimers()
})

describe('Hark status monitor', () => {
  it('emits a completion when a project leaves working and notifies on Linux', async () => {
    hoisted.list.mockResolvedValue({
      conversations: [{ id: 'p1', kind: 'project', title: 'Alpha' }]
    })
    hoisted.statuses
      .mockResolvedValueOnce({ statuses: { p1: 'working' } })
      .mockResolvedValueOnce({ statuses: { p1: 'unread' } })
    const events: HarkConversationStatusEvent[] = []
    const off = onHarkStatusEvent((event) => events.push(event))

    watchHarkStatuses('acc-status-test')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(events).toHaveLength(2)
    expect(events[0]?.statuses.p1).toBe('working')
    expect(events[1]?.completed).toEqual([{ conversationId: 'p1', title: 'Alpha' }])
    expect(hoisted.notifications).toHaveLength(process.platform === 'linux' ? 1 : 0)
    if (process.platform === 'linux') {
      expect(hoisted.notifications[0]).toMatchObject({ title: 'Hark 已完成' })
    }
    off()
  })

  it('does not notify for work that was already finished at baseline', async () => {
    hoisted.list.mockResolvedValue({ conversations: [] })
    hoisted.statuses.mockResolvedValue({ statuses: { p1: 'unread' } })
    watchHarkStatuses('acc-status-baseline')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(hoisted.notifications).toHaveLength(0)
  })

  it('keeps ten accounts live and leaves the rest on the background interval', async () => {
    hoisted.list.mockResolvedValue({ conversations: [] })
    hoisted.statuses.mockResolvedValue({ statuses: {} })
    const total = HARK_LIVE_WATCH_LIMIT + 2
    for (let index = 0; index < total; index += 1) {
      watchHarkStatuses(`acc-live-${index}`, { hot: true, refreshTitles: false })
    }
    await vi.advanceTimersByTimeAsync(0)

    const diagnostics = getHarkWatchDiagnostics()
    expect(diagnostics.filter((watch) => watch.hot)).toHaveLength(HARK_LIVE_WATCH_LIMIT)
    expect(diagnostics.filter((watch) => !watch.hot && watch.intervalMs === 30_000)).toHaveLength(2)

    // The live accounts must all poll again after one 5s tick; the two
    // background accounts stay parked until their 30s timer.
    hoisted.statuses.mockClear()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(hoisted.statuses).toHaveBeenCalledTimes(HARK_LIVE_WATCH_LIMIT)
  })

  it('never evicts a working account and releases it only after completion', async () => {
    hoisted.list.mockResolvedValue({ conversations: [] })
    hoisted.statuses.mockImplementation(async (accountId: string) => ({
      statuses: accountId === 'acc-working' ? { p1: 'working' } : {}
    }))
    watchHarkStatuses('acc-working', { hot: true, refreshTitles: false })
    await vi.advanceTimersByTimeAsync(0)

    for (let index = 0; index < HARK_LIVE_WATCH_LIMIT + 1; index += 1) {
      watchHarkStatuses(`acc-newer-${index}`, { hot: true, refreshTitles: false })
    }
    await vi.advanceTimersByTimeAsync(0)

    const whileWorking = getHarkWatchDiagnostics()
    expect(whileWorking.find((watch) => watch.accountId === 'acc-working')?.hot).toBe(true)
    expect(whileWorking.filter((watch) => watch.hot)).toHaveLength(HARK_LIVE_WATCH_LIMIT)

    // Task finished: the account is now idle and may yield its slot.
    hoisted.statuses.mockResolvedValue({ statuses: {} })
    await vi.advanceTimersByTimeAsync(5_000)
    touchHarkStatuses('acc-just-opened')
    const afterCompletion = getHarkWatchDiagnostics()
    expect(afterCompletion.find((watch) => watch.accountId === 'acc-working')?.working).toBe(false)
    expect(afterCompletion.find((watch) => watch.accountId === 'acc-working')?.hot).toBe(false)
    expect(afterCompletion.filter((watch) => watch.hot)).toHaveLength(HARK_LIVE_WATCH_LIMIT)
  })
})
