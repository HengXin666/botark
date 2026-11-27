import type { WorkspaceMetadataPayload } from '@shared/workspaceMetadata'
import { getBridge } from '@/lib/bridge'
import { useBotStore } from '@/store/botStore'

export interface WorkspaceMetadataResult {
  groupsCreated: number
  groupsRenamed: number
  botsMatched: number
  botsUpdated: number
  botsUnmatched: number
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function handleOf(account: unknown): string {
  if (!account || typeof account !== 'object') return ''
  const row = account as Record<string, unknown>
  return (text(row['handle']) || text(row['displayName'])).toLowerCase()
}

/**
 * Merge a metadata-only patch into the current renderer store.
 *
 * Matching is by account handle rather than bot id because a remote BotArk may
 * import the same Hark account under a different local id (for example
 * `bot_acc_hk...` locally and `bot_acc_hark_hk...` remotely).
 */
export function applyWorkspaceMetadata(payload: WorkspaceMetadataPayload): WorkspaceMetadataResult {
  const state = useBotStore.getState()
  const incomingGroups = Array.isArray(payload.groups) ? payload.groups : []
  const incomingBots = Array.isArray(payload.bots) ? payload.bots : []
  const groups = state.groups.map((group) => ({ ...group }))
  const collapsedGroups = { ...state.collapsedGroups }
  let groupsCreated = 0
  let groupsRenamed = 0

  for (const incoming of incomingGroups) {
    const id = text(incoming?.id)
    const name = text(incoming?.name)
    if (!id || !name) continue
    const existing = groups.find((group) => group.id === id)
    if (existing) {
      if (existing.name !== name) {
        existing.name = name
        groupsRenamed += 1
      }
    } else {
      groups.push({ id, name })
      groupsCreated += 1
    }
    if (typeof incoming.collapsed === 'boolean') collapsedGroups[id] = incoming.collapsed
  }

  const botPatches = new Map<string, { name: string; groupId: string; pinned?: boolean }>()
  for (const incoming of incomingBots) {
    const handle = text(incoming?.matchHandle).toLowerCase()
    const name = text(incoming?.name)
    const groupId = text(incoming?.groupId)
    if (!handle || !name || !groupId) continue
    botPatches.set(handle, {
      name,
      groupId,
      pinned: typeof incoming.pinned === 'boolean' ? incoming.pinned : undefined
    })
  }

  let botsMatched = 0
  let botsUpdated = 0
  const bots = state.bots.map((bot) => {
    const account = state.accounts[bot.activeAccountId] ?? state.accounts[bot.accountIds[0]]
    const handle = handleOf(account)
    const patch = handle ? botPatches.get(handle) : undefined
    if (!patch) return bot
    botsMatched += 1
    const next = { ...bot, name: patch.name, groupId: patch.groupId }
    if (patch.pinned !== undefined) next.pinned = patch.pinned
    if (next.name !== bot.name || next.groupId !== bot.groupId || next.pinned !== bot.pinned) botsUpdated += 1
    return next
  })

  // Remove only groups that became empty; never remove a group that still owns
  // a remote-only bot. This keeps remote-only accounts visible instead of
  // silently dropping them.
  let nextGroups = groups
  if (payload.removeEmptyGroups) {
    const incomingIds = new Set(incomingGroups.map((group) => text(group?.id)).filter(Boolean))
    const nonEmpty = new Set(bots.map((bot) => bot.groupId))
    nextGroups = groups.filter((group) => incomingIds.has(group.id) || nonEmpty.has(group.id))
    if (nextGroups.length === 0) nextGroups = [{ id: 'g-work', name: 'Workspace' }]
  }

  useBotStore.setState({ groups: nextGroups, bots, collapsedGroups })
  return {
    groupsCreated,
    groupsRenamed,
    botsMatched,
    botsUpdated,
    botsUnmatched: state.bots.length - botsMatched
  }
}

function applySafely(detail: WorkspaceMetadataPayload): void {
  if (!detail || typeof detail !== 'object') return
  try {
    applyWorkspaceMetadata(detail)
  } catch (error) {
    console.warn('[workspace-metadata] apply failed', error)
  }
}

/** Fetch the last metadata patch saved by the server and merge it. */
export async function applySavedWorkspaceMetadata(): Promise<void> {
  try {
    const response = await fetch('/api/web/v1/workspace-metadata', {
      credentials: 'same-origin',
      cache: 'no-store'
    })
    if (!response.ok) return
    const data = (await response.json()) as { metadata?: WorkspaceMetadataPayload | null }
    if (data.metadata) applySafely(data.metadata)
  } catch {
    /* offline / not a web runtime */
  }
}

/** Install the renderer-side listener once for the Web runtime. */
export function startWorkspaceMetadataBridge(): () => void {
  const subscribe = getBridge()?.workspaceMetadata?.onApply
  if (subscribe) {
    const unsubscribe = subscribe(applySafely)
    // A push made while this browser was closed is kept on the server; apply
    // it as soon as the authenticated page mounts.
    void applySavedWorkspaceMetadata()
    return unsubscribe
  }

  // Plain browser without the gateway bridge (Vite dev mode): allow a local
  // custom event for testing the merge logic without a server round-trip.
  const listener = (event: Event): void => applySafely((event as CustomEvent<WorkspaceMetadataPayload>).detail)
  window.addEventListener('botark:workspace-metadata', listener)
  return () => window.removeEventListener('botark:workspace-metadata', listener)
}
