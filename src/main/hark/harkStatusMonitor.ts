/**
 * Main-process Hark status monitor.
 *
 * Every signed-in account keeps a background watcher (30s). Up to
 * HARK_LIVE_WATCH_LIMIT accounts form a live pool polled every 5s. Accounts
 * enter the live pool when the user opens them or when any of their
 * conversations is `working`. A working account stays pinned in the live pool
 * until its task finishes; only then may it be replaced by the next account.
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
  intervalMs: number
  /** In the real-time pool (5s) rather than the background pool (30s). */
  hot: boolean
  /** Last time the user opened/touched the account or its work started. */
  lastTouchedAt: number
  /** Last successful or attempted status poll, used to avoid duplicate polls. */
  lastPolledAt: number
  /** Whether any conversation is currently `working`. */
  working: boolean
  refreshTitles: boolean
  inFlight: boolean
  stopped: boolean
  statuses?: Record<string, string>
  titleCache: Map<string, ConversationInfo>
  titlesUpdatedAt: number
  titleRefresh?: Promise<void>
}

export interface HarkStatusWatchOptions {
  /** Poll interval; live accounts use 5s, background accounts 30s. */
  intervalMs?: number
  /** Skip the initial conversation-title refresh for background watchers. */
  refreshTitles?: boolean
  /** Allow a live watcher to return to the background rate. */
  allowDowngrade?: boolean
  /** Force live-pool membership even when the interval is the background rate. */
  hot?: boolean
}

/** At least this many accounts can be watched in real time at once. */
export const HARK_LIVE_WATCH_LIMIT = 10

const LIVE_POLL_INTERVAL_MS = 5_000
const BACKGROUND_POLL_INTERVAL_MS = 30_000
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

function setWatchInterval(accountId: string, watch: AccountWatch, intervalMs: number): void {
  if (watch.timer) clearInterval(watch.timer)
  watch.intervalMs = intervalMs
  watch.timer = setInterval(() => {
    void pollAccount(accountId)
  }, intervalMs)
  watch.timer.unref?.()
}

/** Move an account into the live pool and refresh it immediately when stale. */
function promoteWatch(accountId: string, touch = true): void {
  const watch = watches.get(accountId)
  if (!watch || watch.stopped) return
  if (touch) watch.lastTouchedAt = Date.now()
  watch.hot = true
  if (watch.intervalMs !== LIVE_POLL_INTERVAL_MS) {
    setWatchInterval(accountId, watch, LIVE_POLL_INTERVAL_MS)
  }
  if (Date.now() - watch.lastPolledAt >= LIVE_POLL_INTERVAL_MS) {
    void pollAccount(accountId)
  }
  enforceLiveLimit(accountId)
}

/** Return an idle account to the background pool without stopping its watcher. */
function demoteWatch(accountId: string): void {
  const watch = watches.get(accountId)
  if (!watch || watch.stopped || watch.working) return
  watch.hot = false
  if (watch.intervalMs !== BACKGROUND_POLL_INTERVAL_MS) {
    setWatchInterval(accountId, watch, BACKGROUND_POLL_INTERVAL_MS)
  }
}

/**
 * Keep at most HARK_LIVE_WATCH_LIMIT live watchers. Working accounts are never
 * evicted: if every live account is working the pool temporarily grows rather
 * than losing a running task. `keepId` is the account that just requested
 * promotion, so it is not immediately evicted by its own insertion.
 */
function enforceLiveLimit(keepId?: string): void {
  let live = [...watches.entries()].filter(([, watch]) => watch.hot && !watch.stopped)
  if (live.length <= HARK_LIVE_WATCH_LIMIT) return
  while (live.length > HARK_LIVE_WATCH_LIMIT) {
    const candidate = live
      .filter(([id, watch]) => id !== keepId && !watch.working)
      .sort((left, right) => left[1].lastTouchedAt - right[1].lastTouchedAt)[0]
    if (!candidate) break
    demoteWatch(candidate[0])
    live = live.filter(([id]) => id !== candidate[0])
  }
}

async function pollAccount(accountId: string): Promise<void> {
  const watch = watches.get(accountId)
  if (!watch || watch.stopped || watch.inFlight) return
  watch.inFlight = true
  watch.lastPolledAt = Date.now()
  try {
    const next = readStatuses(await getConversationStatuses(accountId))
    if (!next) {
      console.warn('[hark] status', 'invalid status response', accountId)
      return
    }
    if (watch.stopped || watches.get(accountId) !== watch) return
    const previous = watch.statuses
    const wasWorking = watch.working
    watch.working = Object.values(next).some((status) => status === 'working')
    if (watch.working) {
      // A task started outside the app or while this account was in the
      // background pool must be pulled into the live pool immediately.
      if (!watch.hot) promoteWatch(accountId)
    }
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
    if (wasWorking && !watch.working) {
      // The task is done; the account may now yield its live slot to a newer one.
      enforceLiveLimit()
    }
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

/** Start watching an account. Idempotent; a smaller interval upgrades it. */
export function watchHarkStatuses(
  accountId: string,
  options: HarkStatusWatchOptions = {}
): void {
  const id = accountId.trim()
  if (!id) return
  const intervalMs = Math.max(1_000, options.intervalMs ?? LIVE_POLL_INTERVAL_MS)
  const wantsLive = options.hot === true || intervalMs <= LIVE_POLL_INTERVAL_MS
  const refreshTitlesEnabled = options.refreshTitles !== false
  const existing = watches.get(id)
  if (existing) {
    if (wantsLive) promoteWatch(id)
    else if (options.allowDowngrade) demoteWatch(id)
    if (refreshTitlesEnabled && !existing.refreshTitles) {
      existing.refreshTitles = true
      void refreshTitles(id)
    }
    return
  }
  const watch: AccountWatch = {
    intervalMs: wantsLive ? LIVE_POLL_INTERVAL_MS : BACKGROUND_POLL_INTERVAL_MS,
    hot: wantsLive,
    lastTouchedAt: wantsLive ? Date.now() : 0,
    lastPolledAt: 0,
    working: false,
    refreshTitles: refreshTitlesEnabled,
    inFlight: false,
    stopped: false,
    titleCache: new Map(),
    titlesUpdatedAt: 0
  }
  watches.set(id, watch)
  setWatchInterval(id, watch, watch.intervalMs)
  if (wantsLive) {
    void pollAccount(id)
  } else {
    // Stagger background start-up probes so dozens of accounts do not hit
    // Hark's status endpoint simultaneously.
    setTimeout(() => {
      if (!watch.stopped && watches.get(id) === watch) void pollAccount(id)
    }, Math.floor(Math.random() * Math.min(5_000, watch.intervalMs)))
  }
  if (watch.refreshTitles) void refreshTitles(id)
  if (wantsLive) enforceLiveLimit(id)
}

/** Put an account into the real-time pool, creating its watcher if needed. */
export function touchHarkStatuses(accountId: string): void {
  const id = accountId.trim()
  if (!id) return
  watchHarkStatuses(id, {
    intervalMs: LIVE_POLL_INTERVAL_MS,
    hot: true,
    refreshTitles: true
  })
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

/** Snapshot used by tests and diagnostics to prove the live-pool policy. */
export interface HarkWatchDiagnostic {
  accountId: string
  intervalMs: number
  hot: boolean
  working: boolean
  lastPolledAt: number
  lastTouchedAt: number
  statuses?: Record<string, string>
}

export function getHarkWatchDiagnostics(): HarkWatchDiagnostic[] {
  return [...watches.entries()]
    .sort((left, right) => Number(right[1].hot) - Number(left[1].hot) || left[1].lastTouchedAt - right[1].lastTouchedAt)
    .map(([accountId, watch]) => ({
      accountId,
      intervalMs: watch.intervalMs,
      hot: watch.hot,
      working: watch.working,
      lastPolledAt: watch.lastPolledAt,
      lastTouchedAt: watch.lastTouchedAt,
      statuses: watch.statuses ? { ...watch.statuses } : undefined
    }))
}

/** Stop every watcher (app shutdown). */
export function unwatchAllHarkStatuses(): void {
  for (const accountId of [...watches.keys()]) unwatchHarkStatuses(accountId)
}
