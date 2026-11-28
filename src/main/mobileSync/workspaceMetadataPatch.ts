import type {
  MobileSyncedAccount,
  MobileSyncedBot,
  MobileSyncedGroup,
  MobileWorkspaceSnapshot
} from '@shared/mobileSync'

/** Imported account that may not have a bot in the mirrored workspace yet. */
export interface WorkspaceMetadataAccountHint {
  accountId: string
  handle: string
  displayName?: string
}

export interface WorkspaceMetadataApplyOptions {
  knownAccounts?: WorkspaceMetadataAccountHint[]
  createMissingBots?: boolean
}

export interface WorkspaceMetadataApplyResult {
  groupsCreated: number
  groupsRenamed: number
  botsMatched: number
  botsUpdated: number
  botsCreated: number
  botsUnmatched: number
}

interface IncomingGroup {
  id?: unknown
  name?: unknown
  collapsed?: unknown
}

interface IncomingBot {
  matchHandle?: unknown
  name?: unknown
  groupId?: unknown
  pinned?: unknown
}

interface NormalizedPayload {
  groups: IncomingGroup[]
  bots: IncomingBot[]
  removeEmptyGroups: boolean
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePayload(payload: unknown): NormalizedPayload {
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  return {
    groups: Array.isArray(root['groups']) ? (root['groups'] as IncomingGroup[]) : [],
    bots: Array.isArray(root['bots']) ? (root['bots'] as IncomingBot[]) : [],
    removeEmptyGroups: root['removeEmptyGroups'] === true
  }
}

function handleOf(account: MobileSyncedAccount | undefined): string {
  if (!account) return ''
  return (text(account.handle) || text(account.displayName)).toLowerCase()
}

function accountFromHint(hint: WorkspaceMetadataAccountHint): MobileSyncedAccount {
  const handle = text(hint.handle) || text(hint.displayName)
  return {
    id: text(hint.accountId),
    platformId: 'hark',
    displayName: text(hint.displayName) || handle,
    handle,
    status: 'offline'
  }
}

/**
 * Merge a metadata-only patch into a workspace snapshot, matching bots by the
 * handle of their active account instead of by bot id.
 */
export function applyWorkspaceMetadataPatch(
  snapshot: MobileWorkspaceSnapshot,
  payload: unknown,
  options: WorkspaceMetadataApplyOptions = {}
): { snapshot: MobileWorkspaceSnapshot; result: WorkspaceMetadataApplyResult } {
  const incoming = normalizePayload(payload)
  const result: WorkspaceMetadataApplyResult = {
    groupsCreated: 0,
    groupsRenamed: 0,
    botsMatched: 0,
    botsUpdated: 0,
    botsCreated: 0,
    botsUnmatched: 0
  }

  const groups: MobileSyncedGroup[] = snapshot.groups.map((group) => ({ ...group }))
  const groupIndex = new Map<string, MobileSyncedGroup>(groups.map((group) => [group.id, group]))
  for (const raw of incoming.groups) {
    const id = text(raw?.id)
    const name = text(raw?.name)
    if (!id || !name) continue
    const existing = groupIndex.get(id)
    if (existing) {
      if (existing.name !== name) {
        existing.name = name
        result.groupsRenamed += 1
      }
      if (typeof raw?.collapsed === 'boolean') existing.collapsed = raw.collapsed
      continue
    }
    const created: MobileSyncedGroup = { id, name, collapsed: raw?.collapsed === true }
    groups.push(created)
    groupIndex.set(id, created)
    result.groupsCreated += 1
  }

  const patches = new Map<string, { name: string; groupId: string; pinned?: boolean }>()
  for (const raw of incoming.bots) {
    const handle = text(raw?.matchHandle).toLowerCase()
    const name = text(raw?.name)
    const groupId = text(raw?.groupId)
    if (!handle || !name || !groupId) continue
    patches.set(handle, {
      name,
      groupId,
      pinned: typeof raw?.pinned === 'boolean' ? raw.pinned : undefined
    })
  }

  const accounts: Record<string, MobileSyncedAccount> = { ...snapshot.accounts }
  const bots: MobileSyncedBot[] = []
  for (const bot of snapshot.bots) {
    const handle = handleOf(accounts[bot.activeAccountId])
    const patch = handle ? patches.get(handle) : undefined
    if (!patch) {
      bots.push(bot)
      continue
    }
    result.botsMatched += 1
    const next: MobileSyncedBot = { ...bot, name: patch.name, groupId: patch.groupId }
    if (patch.pinned !== undefined) next.pinned = patch.pinned
    if (next.name !== bot.name || next.groupId !== bot.groupId || next.pinned !== bot.pinned) {
      result.botsUpdated += 1
    }
    bots.push(next)
  }

  if (options.createMissingBots === true && patches.size > 0) {
    const matched = new Set<string>()
    for (const bot of bots) {
      const handle = handleOf(accounts[bot.activeAccountId])
      if (handle && patches.has(handle)) matched.add(handle)
    }
    for (const hint of options.knownAccounts ?? []) {
      const accountId = text(hint?.accountId)
      const handle = (text(hint?.handle) || text(hint?.displayName)).toLowerCase()
      if (!accountId || !handle) continue
      const patch = patches.get(handle)
      if (!patch || matched.has(handle)) continue
      const botId = 'bot_' + accountId
      const index = bots.findIndex((bot) => bot.id === botId)
      if (!accounts[accountId]) accounts[accountId] = accountFromHint(hint)
      if (index >= 0) {
        const existing = bots[index]!
        const next: MobileSyncedBot = { ...existing, name: patch.name, groupId: patch.groupId }
        if (patch.pinned !== undefined) next.pinned = patch.pinned
        if (next.name !== existing.name || next.groupId !== existing.groupId) result.botsUpdated += 1
        bots[index] = next
        matched.add(handle)
        continue
      }
      const created: MobileSyncedBot = {
        id: botId,
        platformId: 'hark',
        name: patch.name,
        groupId: patch.groupId,
        activeAccountId: accountId,
        lastActivityAt: Date.now()
      }
      if (patch.pinned !== undefined) created.pinned = patch.pinned
      bots.push(created)
      result.botsCreated += 1
      matched.add(handle)
    }
  }

  let nextGroups = groups
  if (incoming.removeEmptyGroups) {
    const incomingIds = new Set(incoming.groups.map((group) => text(group?.id)).filter(Boolean))
    const occupied = new Set(bots.map((bot) => bot.groupId))
    nextGroups = groups.filter((group) => incomingIds.has(group.id) || occupied.has(group.id))
    if (nextGroups.length === 0) nextGroups = [{ id: 'g-work', name: 'Workspace', collapsed: false }]
  }

  result.botsUnmatched = snapshot.bots.length - result.botsMatched
  return {
    snapshot: {
      ...snapshot,
      updatedAtMs: Date.now(),
      groups: nextGroups,
      bots,
      accounts
    },
    result
  }
}
