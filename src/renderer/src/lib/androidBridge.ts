import type { BotHubBridge } from '@shared/bridge'
import type { Bot, BotAccount, BotActivity, BotGroup, ChatMessage } from '@/types'
import type { ConnectionStatus, PlatformId } from '@adapters/types'
import { useBotStore } from '@/store/botStore'

/**
 * Android WebView bridge.
 *
 * The Android shell (android/BotArk) hosts the exact Linux renderer bundle in a
 * WebView. Native code exposes {@code window.BotArkNative}; it owns pairing,
 * the desktop WebSocket, Hark/Hermes direct sessions and the proxy core. This
 * module mirrors that native state into the renderer store and forwards the
 * few user actions the mobile shell needs. Keeping the renderer as the only UI
 * means chat/avatars/animations stay pixel-identical to the Linux build.
 */

interface NativeHarkProject {
  id: string
  kind?: string
  title?: string | null
  favorite?: boolean
  archivedAt?: string | null
  createdAt?: string | null
  activityAt?: string
  status?: string | null
}

interface NativeBot {
  id: string
  platformId: PlatformId
  name: string
  avatar?: string | null
  avatarShape?: string | null
  avatarColor?: string | null
  emoji?: string | null
  groupId?: string
  pinned?: boolean | null
  activeAccountId: string
  activeSessionId?: string | null
  activeSessionTitle?: string | null
  activeSessionKind?: string | null
  harkProjectsOpen?: boolean | null
  harkProjects?: NativeHarkProject[]
  standaloneUrl?: string | null
  activityBusy?: boolean
  activityText?: string | null
  lastActivityAt?: number
}

interface NativeAccount {
  id: string
  platformId: PlatformId
  displayName?: string
  handle?: string
  status?: string
  statusDetail?: string | null
}

interface NativeMessage {
  id: string
  botId: string
  accountId?: string
  role: string
  text?: string
  createdAt?: number
  delivery?: string | null
  error?: string | null
  tools?: ChatMessage['tools']
  media?: ChatMessage['media']
}

interface NativeGroup {
  id: string
  name: string
  collapsed?: boolean
}

interface NativeApproval {
  accountId: string
  botId: string
  platformId: string
  id: string
  title: string
  detail?: string | null
  host?: string | null
  reason?: string | null
  decisionOptions?: string[] | null
}

export interface AndroidBridgePayload {
  snapshot: {
    version?: number
    updatedAtMs?: number
    hostName?: string
    selectedBotId?: string | null
    groups?: NativeGroup[]
    bots?: NativeBot[]
    accounts?: Record<string, NativeAccount>
    messages?: Record<string, NativeMessage[]>
    approvals?: Record<string, unknown[]>
  }
  typingByBotId?: Record<string, boolean>
  connection?: { connected?: boolean; label?: string }
  selectedBotId?: string | null
  canSend?: Record<string, boolean>
  hasStandaloneBots?: boolean
  approvals?: NativeApproval[]
  harkResumeLast?: boolean
}

interface AndroidNative {
  getState(): string
  command(action: string, argsJson: string): string
  harkRpc(requestJson: string, callbackId: string): void
}

declare global {
  interface Window {
    BotArkNative?: AndroidNative
    __botarkNativeState?: (raw: string) => void
    __botarkNativeHarkResult?: (callbackId: string, resultJson: string) => void
    __botarkApprovals?: NativeApproval[]
  }
}

const PLACEHOLDER_EMOJI = /^[\s\-–—‐‑‒]*$/
const ALLOWED_STATUS: ConnectionStatus[] = ['online', 'busy', 'attention', 'offline', 'error']

let currentConnection = { connected: false, label: '离线' }
let currentApprovals: NativeApproval[] = []

function normalizeStatus(raw: string | undefined): ConnectionStatus {
  return ALLOWED_STATUS.includes(raw as ConnectionStatus) ? (raw as ConnectionStatus) : 'offline'
}

function normalizeEmoji(raw: string | null | undefined): string {
  if (!raw || PLACEHOLDER_EMOJI.test(raw)) return ''
  return raw
}

function toBot(raw: NativeBot): Bot {
  const projects: NonNullable<Bot['harkProjects']> = (raw.harkProjects ?? []).map((project) => ({
    id: project.id,
    kind: project.kind === 'main' ? 'main' : 'project',
    title: project.title ?? null,
    favorite: project.favorite === true,
    archivedAt: project.archivedAt ?? null,
    ...(project.createdAt ? { createdAt: project.createdAt } : {}),
    activityAt: project.activityAt ?? project.createdAt ?? '',
    ...(project.status ? { status: project.status } : {})
  }))
  return {
    id: raw.id,
    name: raw.name,
    emoji: normalizeEmoji(raw.emoji),
    ...(raw.avatar ? { avatar: raw.avatar } : {}),
    ...(raw.avatarShape ? { avatarShape: raw.avatarShape } : {}),
    ...(raw.avatarColor ? { avatarColor: raw.avatarColor } : {}),
    description: '',
    platformId: raw.platformId,
    groupId: raw.groupId || 'default',
    accountIds: raw.activeAccountId ? [raw.activeAccountId] : [],
    activeAccountId: raw.activeAccountId,
    ...(raw.activeSessionId ? { activeSessionId: raw.activeSessionId } : {}),
    ...(raw.activeSessionTitle ? { activeSessionTitle: raw.activeSessionTitle } : {}),
    ...(raw.activeSessionKind === 'main' || raw.activeSessionKind === 'project'
      ? { activeSessionKind: raw.activeSessionKind }
      : {}),
    ...(raw.harkProjectsOpen !== undefined && raw.harkProjectsOpen !== null
      ? { harkProjectsOpen: raw.harkProjectsOpen }
      : {}),
    ...(projects.length ? { harkProjects: projects } : {}),
    ...(projects.some((project) => project.status)
      ? {
          harkProjectStatuses: Object.fromEntries(
            projects.filter((project) => project.status).map((project) => [project.id, project.status!])
          )
        }
      : {}),
    memory: [],
    notes: '',
    createdAt: raw.lastActivityAt || Date.now(),
    unread: 0,
    pinned: raw.pinned === true
  }
}

function toAccount(raw: NativeAccount): BotAccount {
  return {
    id: raw.id,
    platformId: raw.platformId,
    displayName: raw.displayName?.trim() || raw.handle?.trim() || raw.id,
    handle: raw.handle ?? '',
    status: normalizeStatus(raw.status),
    ...(raw.statusDetail ? { statusDetail: raw.statusDetail } : {}),
    pending: false,
    unread: 0
  }
}

function toMessage(raw: NativeMessage): ChatMessage {
  return {
    id: raw.id,
    botId: raw.botId,
    accountId: raw.accountId ?? '',
    role: raw.role === 'user' ? 'user' : 'bot',
    text: raw.text ?? '',
    createdAt: Number(raw.createdAt) || Date.now(),
    ...(raw.delivery ? { delivery: raw.delivery as ChatMessage['delivery'] } : {}),
    ...(raw.error ? { error: raw.error } : {}),
    ...(raw.tools?.length ? { tools: raw.tools } : {}),
    ...(raw.media?.length ? { media: raw.media } : {})
  }
}

/** Mirror a native workspace payload into the renderer's single source of truth. */
export function applyAndroidState(raw: string): void {
  let payload: AndroidBridgePayload
  try {
    payload = JSON.parse(raw) as AndroidBridgePayload
  } catch {
    return
  }
  const snapshot = payload.snapshot ?? {}
  const existing = useBotStore.getState()
  const rawBots = snapshot.bots ?? []
  const bots = rawBots.map(toBot).filter((bot) => bot.activeAccountId)
  const accounts: Record<string, BotAccount> = {}
  for (const [id, account] of Object.entries(snapshot.accounts ?? {})) {
    accounts[id] = toAccount({ ...account, id: account.id || id })
  }
  const groups: BotGroup[] = (snapshot.groups ?? []).length
    ? (snapshot.groups ?? []).map((group) => ({ id: group.id, name: group.name }))
    : [{ id: 'default', name: 'Workspace' }]
  // Start from the current renderer history so conversations loaded directly
  // over the Hark bridge are not erased by a subsequent workspace snapshot.
  const messages: Record<string, ChatMessage[]> = { ...existing.messages }
  for (const [botId, list] of Object.entries(snapshot.messages ?? {})) {
    messages[botId] = (list ?? []).map(toMessage)
  }
  const activity: Record<string, BotActivity> = {}
  for (const raw of rawBots) {
    if (!raw.activityBusy) continue
    const mapped = bots.find((bot) => bot.id === raw.id)
    if (!mapped) continue
    activity[mapped.activeAccountId] = {
      code: 'working',
      text: raw.activityText ?? null,
      emoji: null,
      busy: true,
      subagents: 0
    }
  }
  const collapsedGroups: Record<string, boolean> = {}
  for (const group of snapshot.groups ?? []) {
    if (group.collapsed) collapsedGroups[group.id] = true
  }
  const keepSelected = existing.selectedBotId && bots.some((bot) => bot.id === existing.selectedBotId)
  const selectedBotId = keepSelected ? existing.selectedBotId : null
  currentConnection = {
    connected: payload.connection?.connected === true,
    label: payload.connection?.label?.trim() || (payload.connection?.connected ? '已连接' : '离线')
  }
  currentApprovals = payload.approvals ?? []
  window.__botarkApprovals = currentApprovals
  useBotStore.setState({
    bots,
    accounts,
    groups,
    messages,
    typing: payload.typingByBotId ?? {},
    activity,
    collapsedGroups,
    selectedBotId,
    harkResumeLastConversation:
      typeof payload.harkResumeLast === 'boolean'
        ? payload.harkResumeLast
        : existing.harkResumeLastConversation,
    sidebarCollapsed: false,
    sidebarWidth: Math.min(360, Math.max(280, existing.sidebarWidth || 300)),
    infoPanelOpen: false
  })
  window.dispatchEvent(new CustomEvent('botark-native-state', { detail: payload }))
}

export function isAndroidShell(): boolean {
  return typeof window !== 'undefined' && Boolean(window.BotArkNative)
}

export function getAndroidConnection(): { connected: boolean; label: string } {
  return currentConnection
}

export function getAndroidApprovals(): NativeApproval[] {
  return currentApprovals
}

export function androidNativeCommand(action: string, args: Record<string, unknown> = {}): void {
  const native = typeof window === 'undefined' ? undefined : window.BotArkNative
  if (!native) return
  try {
    native.command(action, JSON.stringify(args))
  } catch {
    /* Native side may be torn down while the WebView is closing. */
  }
}

let harkSeq = 0
const harkCallbacks = new Map<number, (result: { ok: boolean; data?: unknown; message?: string; status?: number }) => void>()

export function androidHarkRpc(request: Record<string, unknown>): Promise<{
  ok: boolean
  data?: unknown
  message?: string
  status?: number
}> {
  const native = typeof window === 'undefined' ? undefined : window.BotArkNative
  if (!native?.harkRpc) return Promise.resolve({ ok: false, message: 'Hark IPC 不可用' })
  const id = ++harkSeq
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      harkCallbacks.delete(id)
      resolve({ ok: false, message: 'Hark 请求超时' })
    }, 20_000)
    harkCallbacks.set(id, (result) => {
      window.clearTimeout(timer)
      resolve(result)
    })
    const timer = timeout
    try {
      native.harkRpc(JSON.stringify(request), String(id))
    } catch {
      window.clearTimeout(timeout)
      harkCallbacks.delete(id)
      resolve({ ok: false, message: 'Hark IPC 调用失败' })
    }
  })
}

function installHarkResultHandler(): void {
  window.__botarkNativeHarkResult = (callbackId: string, resultJson: string) => {
    const callback = harkCallbacks.get(Number(callbackId))
    if (!callback) return
    harkCallbacks.delete(Number(callbackId))
    try {
      callback(JSON.parse(resultJson))
    } catch {
      callback({ ok: false, message: 'Hark 返回数据损坏' })
    }
  }
}

/** Install the Android bridge once, before React renders. */
export function startAndroidBridge(): () => void {
  const native = typeof window === 'undefined' ? undefined : window.BotArkNative
  if (!native) return () => undefined

  installHarkResultHandler()
  window.__botarkNativeState = applyAndroidState
  window.electron = {
    platform: 'android',
    versions: { electron: '', chrome: '', node: '' },
    hark: {
      rpc: (request: Record<string, unknown>) => androidHarkRpc(request),
      onEvent: () => () => undefined
    },
    muse: {
      openHttps: (url: string) => androidNativeCommand('openUrl', { url })
    }
  } as unknown as BotHubBridge
  try {
    applyAndroidState(native.getState())
  } catch {
    /* The first native state may race WebView initialization; the host pushes it again. */
  }

  return () => {
    delete window.__botarkNativeState
    delete window.__botarkNativeHarkResult
  }
}
