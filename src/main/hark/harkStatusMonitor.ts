/**
 * Main-process Hark status monitor: polls every watched account every 5s,
 * emits snapshot events, and raises Linux desktop notifications when a
 * conversation leaves `working`. Imports only Electron and harkClient so the
 * IPC layer can subscribe without an import cycle.
 */

import { BrowserWindow, Notification } from 'electron'
import { getConversationStatuses, listConversations } from './harkClient'

export interface HarkConversationStatusEvent {
  type: 'conversationStatus'
  accountId: string
  statuses: Record<string, string>
  previous: Record<string, string>
  completed: Array<{ conversationId: string; title: string }>
}

type StatusListener = (event: HarkConversationStatusEvent) => void
type NotificationClickHandler = (accountId: string, conversationId: string) => void

interface ConversationInfo {
  kind: 'main' | 'project'
  title: string | null
}

interface AccountWatch {
  timer?: ReturnType<typeof setInterval>
  inFlight: boolean
  stopped: boolean
  statuses?: Record<string, string>
  titleCache: Map<string, ConversationInfo>
  titlesUpdatedAt: number
  titleRefresh?: Promise<void>
}

const POLL_INTERVAL_MS = 5_000
const TITLE_CACHE_TTL_MS = 60_000
const watches = new Map<string, AccountWatch>()
const listeners = new Set<StatusListener>()
let notificationClickHandler: NotificationClickHandler | undefined

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function readStatuses(payload: unknown): Record<string, string> | undefined {
  const record = asRecord(payload)
  const rawStatuses = record ? asRecord(record['statuses']) : undefined
  if (!rawStatuses) return undefined
  const statuses: Record<string, string> = {}
  for (const [conversationId, value] of Object.entries(rawStatuses)) {
    if (typeof value === 'string') statuses[conversationId] = value
  }
  return statuses
}

function readConversations(payload: unknown): Map<string, ConversationInfo> {
  const record = asRecord(payload)
  const list = record && Array.isArray(record['conversations']) ? record['conversations'] : []
  const cache = new Map<string, ConversationInfo>()
  for (const entry of list) {
    const item = asRecord(entry)
    if (!item || typeof item['id'] !== 'string' || !item['id']) continue
    const titleValue = item['title']
    const title = typeof titleValue === 'string' && titleValue.trim() ? titleValue.trim() : null
    cache.set(item['id'], { kind: item['kind'] === 'main' ? 'main' : 'project', title })
  }
  return cache
}

function emitStatusEvent(event: HarkConversationStatusEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch (error) {
      console.warn('[hark] status', 'listener failed', errorMessage(error))
    }
  }
}

/** Refresh conversation titles, deduplicating concurrent calls. */
function refreshTitles(accountId: string): Promise<void> {
  const watch = watches.get(accountId)
  if (!watch || watch.stopped) return Promise.resolve()
  if (watch.titleRefresh) return watch.titleRefresh
  const task = (async () => {
    watch.titlesUpdatedAt = Date.now()
    try {
      const cache = readConversations(await listConversations(accountId))
      if (!watch.stopped && watches.get(accountId) === watch) watch.titleCache = cache
    } catch (error) {
      console.warn('[hark] status', 'title refresh failed', errorMessage(error))
    }
  })()
  watch.titleRefresh = task
  void task.finally(() => {
    if (watch.titleRefresh === task) watch.titleRefresh = undefined
  })
  return task
}

function titleFor(watch: AccountWatch, conversationId: string): string {
  const info = watch.titleCache.get(conversationId)
  if (info?.title) return info.title
  if (info?.kind === 'main') return '主对话'
  return 'Hark 项目'
}

function focusFirstWindow(): void {
  try {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  } catch (error) {
    console.warn('[hark] status', 'focus window failed', errorMessage(error))
  }
}

function handleNotificationClick(accountId: string, conversationId: string): void {
  focusFirstWindow()
  if (!notificationClickHandler) return
  try {
    notificationClickHandler(accountId, conversationId)
  } catch (error) {
    console.warn('[hark] status', 'notification click failed', errorMessage(error))
  }
}

function showCompletedNotification(accountId: string, conversationId: string, title: string): void {
  if (process.platform !== 'linux') return
  try {
    if (!Notification.isSupported()) return
    const notification = new Notification({
      title: 'Hark 已完成',
      body: `「${title}」已完成，点击查看`,
      silent: false
    })
    notification.on('click', () => handleNotificationClick(accountId, conversationId))
    notification.show()
  } catch (error) {
    console.warn('[hark] status', 'notification failed', errorMessage(error))
  }
}

async function pollAccount(accountId: string): Promise<void> {
  const watch = watches.get(accountId)
  if (!watch || watch.stopped || watch.inFlight) return
  watch.inFlight = true
  try {
    const next = readStatuses(await getConversationStatuses(accountId))
    if (!next) {
      console.warn('[hark] status', 'invalid status response', accountId)
      return
    }
    if (watch.stopped || watches.get(accountId) !== watch) return
    const previous = watch.statuses
    if (!previous) {
      // Baseline: remember current states; never notify for already-finished ones.
      watch.statuses = next
      emitStatusEvent({ type: 'conversationStatus', accountId, statuses: next, previous: {}, completed: [] })
      return
    }
    const completedIds: string[] = []
    for (const [conversationId, status] of Object.entries(previous)) {
      if (status !== 'working') continue
      // Missing from the next map also counts as completed.
      if (next[conversationId] !== 'working') completedIds.push(conversationId)
    }
    if (
      completedIds.some((id) => !watch.titleCache.has(id)) ||
      Date.now() - watch.titlesUpdatedAt >= TITLE_CACHE_TTL_MS
    ) {
      await refreshTitles(accountId)
    }
    if (watch.stopped || watches.get(accountId) !== watch) return
    watch.statuses = next
    const completed = completedIds.map((conversationId) => ({
      conversationId,
      title: titleFor(watch, conversationId)
    }))
    const workingIds = Object.entries(next).filter(([, value]) => value === 'working').map(([id]) => id)
    const previousWorkingIds = Object.entries(previous).filter(([, value]) => value === 'working').map(([id]) => id)
    if (completedIds.length > 0 || previousWorkingIds.join(',') !== workingIds.join(',')) {
      console.info('[hark] status', accountId, JSON.stringify({ working: workingIds, completed: completedIds }))
    }
    emitStatusEvent({ type: 'conversationStatus', accountId, statuses: next, previous, completed })
    for (const item of completed) showCompletedNotification(accountId, item.conversationId, item.title)
  } catch (error) {
    console.warn('[hark] status', accountId, 'poll failed:', errorMessage(error))
  } finally {
    watch.inFlight = false
  }
}

/** Subscribe to status snapshots. Returns an unsubscribe function. */
export function onHarkStatusEvent(listener: StatusListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Register the navigation callback used when a Linux notification is clicked. */
export function setHarkNotificationClickHandler(handler: NotificationClickHandler): void {
  notificationClickHandler = handler
}

/** Start watching an account. Idempotent; polls once immediately, then every 5s. */
export function watchHarkStatuses(accountId: string): void {
  const id = accountId.trim()
  if (!id || watches.has(id)) return
  const watch: AccountWatch = {
    inFlight: false,
    stopped: false,
    titleCache: new Map(),
    titlesUpdatedAt: 0
  }
  watches.set(id, watch)
  watch.timer = setInterval(() => {
    void pollAccount(id)
  }, POLL_INTERVAL_MS)
  watch.timer.unref?.()
  void pollAccount(id)
  void refreshTitles(id)
}

/** Stop watching an account and release its timer/state. */
export function unwatchHarkStatuses(accountId: string): void {
  const id = accountId.trim()
  const watch = watches.get(id)
  if (!watch) return
  watch.stopped = true
  if (watch.timer) clearInterval(watch.timer)
  watches.delete(id)
}

/** Last observed status map, for IPC queries. */
export function getHarkStatuses(accountId: string): Record<string, string> | undefined {
  const statuses = watches.get(accountId.trim())?.statuses
  return statuses ? { ...statuses } : undefined
}

/** Stop every watcher (app shutdown). */
export function unwatchAllHarkStatuses(): void {
  for (const accountId of [...watches.keys()]) unwatchHarkStatuses(accountId)
}
