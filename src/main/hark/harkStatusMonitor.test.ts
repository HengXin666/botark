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
  onHarkStatusEvent,
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
})
