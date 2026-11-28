/**
 * Gateway fleet endpoint shapes, response parsers and workspace diff helpers.
 */

export const FLEET_DEFAULT_TARGET_PRO2 = 17
export const FLEET_DEFAULT_FUEL_PER_INVITER = 3
export const FLEET_DEFAULT_PREFIX = 'hkfz'
export const FLEET_DEFAULT_DELAY = 25
export const FLEET_DEFAULT_SHOW_RATE = 0.25

export interface FleetPlanRequest {
  target_pro2: number
  inviter_count?: number
  show_rate?: number
  refresh?: boolean
}

export interface FleetQuotaInfo {
  source: string
  sampled_at: number | null
  age_s: number | null
}

export interface FleetProbeInfo {
  sampled_at: number | null
  age_s: number | null
  stale: boolean
  running: boolean
}

export interface FleetRegisterInfo {
  ok: boolean
  stage: string
  reason: string
  checked_at: number | null
  last_job: string
}

export interface FleetInviter {
  email: string
  friends_to_next_reward: number | null
  code: string
  rewards_earned: number | null
  source: string
}

export interface FleetPlan {
  ok: boolean
  pool_accounts: number | null
  pro2_count: number | null
  pro1_count: number | null
  unknown: number | null
  unreachable: number | null
  available_count: number | null
  inviters: FleetInviter[]
  fuel_needed: number | null
  target_pro2: number | null
  target_gap: number | null
  inviter_count: number | null
  inviter_gap: number | null
  show_rate: number | null
  candidate_inviters: number | null
  fuel_per_inviter: number | null
  register_count: number | null
  expected_pro2: number | null
  quota: FleetQuotaInfo | null
  probe: FleetProbeInfo | null
  register: FleetRegisterInfo | null
  error: string
}

export type FleetStageStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped'

export interface FleetStage {
  name: string
  stage: string
  status: FleetStageStatus
  success: number | null
  failed: number | null
  total: number | null
  error: string
}

export interface FleetStatus {
  ok: boolean
  job_id: string
  running: boolean
  dry_run: boolean
  stage: string
  stages: FleetStage[]
  summary: Record<string, unknown>
  error: string
}

export interface FleetRunRequest {
  target_pro2: number
  inviter_count?: number
  register_count?: number
  fuel_per_inviter: number
  prefix: string
  delay: number
  dry_run: boolean
  domains?: string[]
  max_attempts?: number
}

export interface FleetRunReply {
  ok: boolean
  job_id: string
  running: boolean
  dry_run: boolean
  stages: FleetStage[]
  error: string
  already_running: boolean
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

export interface FleetPullRequest {
  url?: string
  token?: string
}

export interface RemoteWorkspaceSnapshot {
  groups: Array<{ id: string; name: string }>
  accounts: string[]
  imports: string[]
  bots: Array<{ handle: string; name: string; groupId: string }>
}

/** Read a finite number, or null when the value is absent or not numeric. */
export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asBool(value: unknown): boolean {
  return value === true
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function parseInviters(raw: unknown): FleetInviter[] {
  if (!Array.isArray(raw)) return []
  const out: FleetInviter[] = []
  for (const row of raw) {
    const doc = asRecord(row)
    const email = asText(doc.email).toLowerCase()
    if (!email) continue
    out.push({
      email,
      friends_to_next_reward: asNumber(doc.friends_to_next_reward),
      code: asText(doc.code),
      rewards_earned: asNumber(doc.rewards_earned),
      source: asText(doc.source)
    })
  }
  return out
}

function parseQuota(raw: unknown): FleetQuotaInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = asRecord(raw)
  return {
    source: asText(doc.source),
    sampled_at: asNumber(doc.sampled_at),
    age_s: asNumber(doc.age_s)
  }
}

function parseProbe(raw: unknown): FleetProbeInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = asRecord(raw)
  return {
    sampled_at: asNumber(doc.sampled_at),
    age_s: asNumber(doc.age_s),
    stale: asBool(doc.stale),
    running: asBool(doc.running)
  }
}

function parseRegister(raw: unknown): FleetRegisterInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = asRecord(raw)
  return {
    ok: asBool(doc.ok),
    stage: asText(doc.stage),
    reason: asText(doc.reason),
    checked_at: asNumber(doc.checked_at),
    last_job: asText(doc.last_job)
  }
}

function errorText(doc: unknown, status: number): string {
  const record = asRecord(doc)
  const direct = asText(record.error) || asText(record.reason) || asText(record.message)
  if (direct) return direct
  if (status >= 400) return 'HTTP ' + status
  return ''
}

/** Parse GET /api/fleet/plan, keeping absent fields null instead of guessing. */
export function parseFleetPlan(raw: unknown, status = 200): FleetPlan {
  const doc = asRecord(raw)
  const pro2 = asNumber(doc.pro2_count) ?? asNumber(doc.pro2)
  const pro1 = asNumber(doc.pro1_count) ?? asNumber(doc.pro1)
  return {
    ok: recordOk(doc, status),
    pool_accounts: asNumber(doc.pool_accounts),
    pro2_count: pro2,
    pro1_count: pro1,
    unknown: asNumber(doc.unknown),
    unreachable: asNumber(doc.unreachable),
    available_count: asNumber(doc.available_count),
    inviters: parseInviters(doc.available_inviters),
    fuel_needed: asNumber(doc.fuel_needed),
    target_pro2: asNumber(doc.target_pro2),
    target_gap: asNumber(doc.target_gap) ?? asNumber(doc.pro2_gap),
    inviter_count: asNumber(doc.inviter_count),
    inviter_gap: asNumber(doc.inviter_gap),
    show_rate: asNumber(doc.show_rate),
    candidate_inviters: asNumber(doc.candidate_inviters),
    fuel_per_inviter: asNumber(doc.fuel_per_inviter),
    register_count: asNumber(doc.register_count),
    expected_pro2: asNumber(doc.expected_pro2),
    quota: parseQuota(doc.quota),
    probe: parseProbe(doc.probe),
    register: parseRegister(doc.register),
    error: errorText(doc, status)
  }
}

function recordOk(doc: Record<string, unknown>, status: number): boolean {
  if (status < 200 || status >= 300) return false
  if (!('ok' in doc)) return true
  return doc.ok === true
}

const STAGE_STATUSES: FleetStageStatus[] = ['pending', 'running', 'ok', 'failed', 'skipped']

function parseStageStatus(value: unknown): FleetStageStatus {
  const text = asText(value).toLowerCase()
  return STAGE_STATUSES.includes(text as FleetStageStatus) ? (text as FleetStageStatus) : 'pending'
}

function parseStage(raw: unknown): FleetStage | null {
  const doc = asRecord(raw)
  const name = asText(doc.name) || asText(doc.stage)
  if (!name) return null
  return {
    name,
    stage: asText(doc.stage) || name,
    status: parseStageStatus(doc.status),
    success: asNumber(doc.success),
    failed: asNumber(doc.failed),
    total: asNumber(doc.total),
    error: asText(doc.error)
  }
}

/** Parse a stage array from a fleet run or status reply. */
export function parseFleetStages(raw: unknown): FleetStage[] {
  if (!Array.isArray(raw)) return []
  const out: FleetStage[] = []
  for (const row of raw) {
    const stage = parseStage(row)
    if (stage) out.push(stage)
  }
  return out
}

/** Parse GET /api/fleet/status. */
export function parseFleetStatus(raw: unknown, status = 200): FleetStatus {
  const doc = asRecord(raw)
  return {
    ok: recordOk(doc, status),
    job_id: asText(doc.job_id),
    running: asBool(doc.running),
    dry_run: asBool(doc.dry_run),
    stage: asText(doc.stage),
    stages: parseFleetStages(doc.stages),
    summary: asRecord(doc.summary),
    error: errorText(doc, status)
  }
}

/** Parse POST /api/fleet/run, including the 409 already-running reply. */
export function parseFleetRunReply(raw: unknown, status = 200): FleetRunReply {
  const doc = asRecord(raw)
  const already = status === 409 || asText(doc.error) === 'already_running'
  return {
    ok: recordOk(doc, status),
    job_id: asText(doc.job_id),
    running: asBool(doc.running),
    dry_run: asBool(doc.dry_run),
    stages: parseFleetStages(doc.stages),
    error: errorText(doc, status),
    already_running: already
  }
}

/** Build the query string for GET /api/fleet/plan. */
export function fleetPlanQuery(request: FleetPlanRequest): string {
  const params = new URLSearchParams()
  params.set('target_pro2', String(Math.max(0, Math.trunc(request.target_pro2))))
  if (typeof request.inviter_count === 'number' && Number.isFinite(request.inviter_count)) {
    params.set('inviter_count', String(Math.max(0, Math.trunc(request.inviter_count))))
  }
  if (typeof request.show_rate === 'number' && Number.isFinite(request.show_rate)) {
    params.set('show_rate', String(request.show_rate))
  }
  if (request.refresh === true) params.set('refresh', '1')
  return params.toString()
}

/** Default registration count derived from the fuel rule. */
export function defaultRegisterCount(targetPro2: number, fuelPerInviter: number): number {
  const target = Math.max(0, Math.trunc(targetPro2))
  const fuel = Math.max(0, Math.trunc(fuelPerInviter))
  return target * fuel
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
