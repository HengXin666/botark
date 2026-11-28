/**
 * Local to remote workspace diff helpers for the fleet panel.
 */
export interface RemoteWorkspaceSnapshot {
  groups: Array<{ id: string; name: string }>
  accounts: string[]
  imports: string[]
  bots: Array<{ handle: string; name: string; groupId: string }>
}

export interface FleetLocalRow {
  email: string
  name: string
  groupId: string
  groupName: string
}

export interface FleetRemoteRow {
  email: string
  name: string
  groupName: string
}

export interface FleetRowDiff {
  email: string
  local: string
  remote: string
}

export interface WorkspaceDiff {
  local_accounts: number
  remote_accounts: number
  local_only: string[]
  remote_only: string[]
  name_diff: FleetRowDiff[]
  group_diff: FleetRowDiff[]
  same: number
  ok: boolean
}

/** Resolve the handle a bot is backed by, lower-cased. */
export function handleOfBot(
  bot: { activeAccountId?: string; accountIds?: string[] },
  accounts: Record<string, { handle?: string; displayName?: string; platformId?: string }>
): string {
  const first = bot.activeAccountId || bot.accountIds?.[0] || ''
  const account = accounts[first]
  if (!account) return ''
  if (account.platformId && account.platformId !== 'hark') return ''
  return (account.handle || account.displayName || '').trim().toLowerCase()
}

/** Collect local Hark bots with their names and group names. */
export function localWorkspaceRows(
  bots: Array<{ name: string; groupId: string; activeAccountId?: string; accountIds?: string[] }>,
  accounts: Record<string, { handle?: string; displayName?: string; platformId?: string }>,
  groups: Array<{ id: string; name: string }>
): FleetLocalRow[] {
  const groupName = new Map<string, string>()
  for (const group of groups) groupName.set(group.id, group.name)
  const out: FleetLocalRow[] = []
  const seen = new Set<string>()
  for (const bot of bots) {
    const email = handleOfBot(bot, accounts)
    if (!email || seen.has(email)) continue
    seen.add(email)
    out.push({
      email,
      name: bot.name,
      groupId: bot.groupId,
      groupName: groupName.get(bot.groupId) ?? ''
    })
  }
  return out
}

/** Collect remote workspace rows from a pulled VPS snapshot. */
export function remoteWorkspaceRows(snapshot: RemoteWorkspaceSnapshot): FleetRemoteRow[] {
  const groupName = new Map<string, string>()
  for (const group of snapshot.groups) groupName.set(group.id, group.name)
  const names = new Map<string, { name: string; groupName: string }>()
  for (const bot of snapshot.bots) {
    const email = bot.handle.trim().toLowerCase()
    if (!email) continue
    names.set(email, { name: bot.name, groupName: groupName.get(bot.groupId) ?? '' })
  }
  const handles = new Set<string>()
  for (const handle of snapshot.accounts) handles.add(handle.trim().toLowerCase())
  for (const handle of snapshot.imports) handles.add(handle.trim().toLowerCase())
  const out: FleetRemoteRow[] = []
  for (const email of handles) {
    if (!email) continue
    const known = names.get(email)
    out.push({ email, name: known?.name ?? '', groupName: known?.groupName ?? '' })
  }
  return out
}

/** Compare local and remote workspaces by account set, bot name and group name. */
export function diffWorkspace(local: FleetLocalRow[], remote: FleetRemoteRow[]): WorkspaceDiff {
  const localMap = new Map<string, FleetLocalRow>()
  for (const row of local) localMap.set(row.email, row)
  const remoteMap = new Map<string, FleetRemoteRow>()
  for (const row of remote) remoteMap.set(row.email, row)
  const common = [...localMap.keys()].filter((email) => remoteMap.has(email)).sort()
  const nameDiff: FleetRowDiff[] = []
  const groupDiff: FleetRowDiff[] = []
  for (const email of common) {
    const left = localMap.get(email)!
    const right = remoteMap.get(email)!
    if (left.name !== right.name) {
      nameDiff.push({ email, local: left.name, remote: right.name })
    }
    if (left.groupName !== right.groupName) {
      groupDiff.push({ email, local: left.groupName, remote: right.groupName })
    }
  }
  const localOnly = [...localMap.keys()].filter((email) => !remoteMap.has(email)).sort()
  const remoteOnly = [...remoteMap.keys()].filter((email) => !localMap.has(email)).sort()
  const same = common.length - countChanged(nameDiff, groupDiff)
  return {
    local_accounts: localMap.size,
    remote_accounts: remoteMap.size,
    local_only: localOnly,
    remote_only: remoteOnly,
    name_diff: nameDiff,
    group_diff: groupDiff,
    same,
    ok: localOnly.length === 0 && remoteOnly.length === 0 && nameDiff.length === 0 && groupDiff.length === 0
  }
}

function countChanged(nameDiff: FleetRowDiff[], groupDiff: FleetRowDiff[]): number {
  return new Set([...nameDiff, ...groupDiff].map((row) => row.email)).size
}

/** Build the payload the VPS import endpoint expects from local rows. */
export function toMirrorPayload(
  rows: FleetLocalRow[],
  groups: Array<{ id: string; name: string }>
): {
  groups: Array<{ id: string; name: string }>
  bots: Array<{ email: string; name: string; groupId: string }>
} {
  const used = new Set(rows.map((row) => row.groupId).filter(Boolean))
  return {
    groups: groups.filter((group) => used.has(group.id)).map((group) => ({ id: group.id, name: group.name })),
    bots: rows.map((row) => ({ email: row.email, name: row.name, groupId: row.groupId }))
  }
}
