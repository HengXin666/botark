/**
 * Live Hark activity subscription for the conversation currently open in the UI.
 *
 * `GET /api/conversations/status` only reports working/unread, which is why the
 * desktop used to show a generic `正在工作…`. The real status text travels on the
 * conversation sync stream as `narration_update` / `message_update.fields.narration`
 * patches. This monitor keeps that stream open for the active conversation and
 * forwards every change, falling back to `/api/sync/poll` when SSE cannot connect.
 */

import { randomUUID } from 'node:crypto'
import type { Session } from 'electron'
import {
  HARK_API_BASE,
  HarkConversationSyncState,
  harkClientHeaders,
  preparedSessionForAccount
} from './harkClient'

export interface HarkActivityUpdate {
  conversationId: string
  text: string | null
  busy: boolean
}

type ActivityListener = (update: HarkActivityUpdate) => void

interface ActivityWatch {
  accountId: string
  conversationId: string
  controller: AbortController
  stopped: boolean
  lastText: string | null
  lastBusy: boolean | null
}

const watches = new Map<string, ActivityWatch>()
const SSE_READ_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 1_500
const POLL_FALLBACK_MS = 15_000
const RETRY_MS = 2_000

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(finish, ms)
    function finish(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    signal.addEventListener('abort', finish, { once: true })
  })
}

function publish(state: HarkConversationSyncState, watch: ActivityWatch, listener: ActivityListener): void {
  const text = state.activityText()
  // Text alone is not liveness: a finished turn can still carry its last line.
  const busy = state.isWorking()
  if (text === watch.lastText && busy === watch.lastBusy) return
  watch.lastText = text
  watch.lastBusy = busy
  listener({ conversationId: watch.conversationId, text, busy })
}

/** Start (or replace) the live activity watch for one account. */
export function watchHarkActivity(
  accountId: string,
  conversationId: string,
  listener: ActivityListener
): void {
  const id = accountId.trim()
  const cid = conversationId.trim()
  if (!id || !cid) return
  unwatchHarkActivity(id)
  const watch: ActivityWatch = {
    accountId: id,
    conversationId: cid,
    controller: new AbortController(),
    stopped: false,
    lastText: null,
    lastBusy: null
  }
  watches.set(id, watch)
  void run(watch, listener)
}

/** Stop the activity watch for an account, optionally only for one conversation. */
export function unwatchHarkActivity(accountId: string, conversationId?: string): void {
  const id = accountId.trim()
  const watch = watches.get(id)
  if (!watch) return
  if (conversationId && watch.conversationId !== conversationId.trim()) return
  watch.stopped = true
  watch.controller.abort()
  watches.delete(id)
}

export function unwatchAllHarkActivity(): void {
  for (const accountId of [...watches.keys()]) unwatchHarkActivity(accountId)
}

async function run(watch: ActivityWatch, listener: ActivityListener): Promise<void> {
  const state = new HarkConversationSyncState()
  // A tab identity must survive reconnects; a fresh manager on every retry would
  // look like a different viewer to Hark's sync hub.
  const manager = randomUUID()
  let dial = 'initial'
  while (!watch.stopped) {
    try {
      const session = await preparedSessionForAccount(watch.accountId)
      const url = new URL(`${HARK_API_BASE}/sync/conversation`)
      url.searchParams.set('conversationId', watch.conversationId)
      url.searchParams.set('v', '2')
      url.searchParams.set('manager', manager)
      url.searchParams.set('mode', 'in_tab')
      url.searchParams.set('ids', '1')
      url.searchParams.set('beat', '5')
      url.searchParams.set('dial', dial)
      dial = 'reconnect'
      const response = await session.fetch(url.toString(), {
        method: 'GET',
        headers: harkClientHeaders({ Accept: 'text/event-stream', 'Cache-Control': 'no-cache' }),
        signal: AbortSignal.any([watch.controller.signal, AbortSignal.timeout(SSE_READ_TIMEOUT_MS)])
      })
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        throw new Error(`Hark sync stream unavailable (${response.status})`)
      }
      await readStream(response.body, state, watch, listener)
    } catch {
      if (watch.stopped) return
      await pollFallback(watch, state, listener)
      if (watch.stopped) return
      await sleep(RETRY_MS, watch.controller.signal)
    }
  }
}

async function readStream(
  body: ReadableStream<Uint8Array>,
  state: HarkConversationSyncState,
  watch: ActivityWatch,
  listener: ActivityListener
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []
  let eventType = 'message'
  try {
    while (!watch.stopped) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (line === '') {
          if (dataLines.length > 0) {
            const payload = dataLines.join('\n')
            dataLines = []
            if (eventType === 'message' && state.applyFrame(payload)) publish(state, watch, listener)
          }
          eventType = 'message'
        } else if (line.startsWith('event:')) {
          eventType = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* already released */
    }
  }
}

async function pollFallback(
  watch: ActivityWatch,
  state: HarkConversationSyncState,
  listener: ActivityListener
): Promise<void> {
  let session: Session
  try {
    session = await preparedSessionForAccount(watch.accountId)
  } catch {
    return
  }
  const manager = randomUUID()
  let cursor: string | undefined
  let floor: string | undefined
  let first = true
  const deadline = Date.now() + POLL_FALLBACK_MS
  while (!watch.stopped && Date.now() < deadline) {
    try {
      const url = new URL(`${HARK_API_BASE}/sync/poll`)
      url.searchParams.set('conversationId', watch.conversationId)
      url.searchParams.set('v', '2')
      url.searchParams.set('manager', manager)
      url.searchParams.set('mode', 'in_tab')
      url.searchParams.set('dial', 'initial')
      if (first) url.searchParams.set('first', '1')
      if (cursor) url.searchParams.set('cursor', cursor)
      if (floor) url.searchParams.set('floor', floor)
      const response = await session.fetch(url.toString(), {
        method: 'GET',
        headers: harkClientHeaders(),
        signal: AbortSignal.any([watch.controller.signal, AbortSignal.timeout(20_000)])
      })
      if (response.ok) {
        const payload = (await response.json()) as { frames?: string[]; cursor?: string; floor?: string }
        if (Array.isArray(payload.frames)) {
          first = false
          if (payload.cursor) cursor = payload.cursor
          if (payload.floor) floor = payload.floor
          for (const frame of payload.frames) {
            if (state.applyFrame(frame)) publish(state, watch, listener)
          }
        }
      }
    } catch {
      /* retry until this fallback window ends */
    }
    await sleep(POLL_INTERVAL_MS, watch.controller.signal)
  }
}