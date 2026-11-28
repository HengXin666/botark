/**
 * Gateway fleet endpoint shapes, response parsers and workspace diff helpers.
 */

export const FLEET_DEFAULT_TARGET_PRO2 = 17
export const FLEET_DEFAULT_FUEL_PER_INVITER = 3
export const FLEET_DEFAULT_PREFIX = 'hkfz'
export const FLEET_DEFAULT_DELAY = 25
export const FLEET_DEFAULT_SHOW_RATE = 0.25
export const STALE_AFTER_S = 900

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
  stale_s: number | null
  stale: boolean
  refresh_route: string
}

export interface FleetTierSources {
  cache: number | null
  pool: number | null
  none: number | null
}

export interface FleetProbeInfo {
  sampled_at: number | null
  age_s: number | null
  stale: boolean
  running: boolean
}

export type FleetRegisterVerdict = 'ok' | 'failed' | 'running' | 'stopped' | 'unknown' | ''

export interface FleetRegisterInfo {
  verdict: FleetRegisterVerdict
  ok: boolean
  running: boolean
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
  counted: number | null
  source: string
}

export interface FleetPlan {
  ok: boolean
  pool_accounts: number | null
  pro2_count: number | null
  pro1_count: number | null
  skip_count: number | null
  unknown: number | null
  unreachable: number | null
  available_count: number | null
  inviters: FleetInviter[]
  fuel_needed: number | null
  fuel_count: number | null
  target_pro2: number | null
  target_gap: number | null
  no_expansion: boolean
  inviter_count: number | null
  inviter_gap: number | null
  show_rate: number | null
  candidate_inviters: number | null
  fuel_per_inviter: number | null
  register_count: number | null
  expected_pro2: number | null
  quota: FleetQuotaInfo | null
  tier_sources: FleetTierSources | null
  probe: FleetProbeInfo | null
  register: FleetRegisterInfo | null
  error: string
}

export interface FleetStageTiers {
  pro2: number | null
  pro1: number | null
  skip: number | null
  failed: number | null
  unknown: number | null
  available: boolean
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
  detail: string
  tiers: FleetStageTiers | null
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

export interface FleetPullRequest {
  url?: string
  token?: string
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
      counted: asNumber(doc.counted),
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
    age_s: asNumber(doc.age_s),
    stale_s: asNumber(doc.stale_s),
    stale: asBool(doc.stale),
    refresh_route: asText(doc.refresh_route)
  }
}

function parseTierSources(raw: unknown): FleetTierSources | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = asRecord(raw)
  return {
    cache: asNumber(doc.cache),
    pool: asNumber(doc.pool),
    none: asNumber(doc.none)
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

/** Read the gateway verdict, keeping an unrecognised value rather than guessing. */
function parseRegisterVerdict(value: unknown): FleetRegisterVerdict {
  const text = asText(value)
  if (
    text === 'ok' ||
    text === 'failed' ||
    text === 'running' ||
    text === 'stopped' ||
    text === 'unknown'
  ) {
    return text
  }
  return ''
}

function parseRegister(raw: unknown): FleetRegisterInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = asRecord(raw)
  return {
    verdict: parseRegisterVerdict(doc.verdict),
    ok: asBool(doc.ok),
    running: asBool(doc.running),
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
    skip_count: asNumber(doc.skip_count),
    unknown: asNumber(doc.unknown),
    unreachable: asNumber(doc.unreachable),
    available_count: asNumber(doc.available_count),
    inviters: parseInviters(doc.available_inviters),
    fuel_needed: asNumber(doc.fuel_needed),
    fuel_count: asNumber(doc.fuel_count),
    target_pro2: asNumber(doc.target_pro2),
    target_gap: asNumber(doc.target_gap) ?? asNumber(doc.pro2_gap),
    no_expansion: asBool(doc.no_expansion),
    inviter_count: asNumber(doc.inviter_count),
    inviter_gap: asNumber(doc.inviter_gap),
    show_rate: asNumber(doc.show_rate),
    candidate_inviters: asNumber(doc.candidate_inviters),
    fuel_per_inviter: asNumber(doc.fuel_per_inviter),
    register_count: asNumber(doc.register_count),
    expected_pro2: asNumber(doc.expected_pro2),
    quota: parseQuota(doc.quota),
    tier_sources: parseTierSources(doc.tier_sources),
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

function parseStageTiers(raw: unknown): FleetStageTiers | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = asRecord(raw)
  return {
    pro2: asNumber(doc.pro2),
    pro1: asNumber(doc.pro1),
    skip: asNumber(doc.skip),
    failed: asNumber(doc.failed),
    unknown: asNumber(doc.unknown),
    available: asBool(doc.available)
  }
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
    error: asText(doc.error),
    detail: asText(doc.detail),
    tiers: parseStageTiers(doc.tiers)
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

export { snapshotAge, probeIsStale, firstFailedStage, stalledAtFirstStage } from './fleetFreshness'
export type {
  FleetLocalRow,
  FleetRemoteRow,
  FleetRowDiff,
  WorkspaceDiff,
  RemoteWorkspaceSnapshot
} from './fleetDiff'
export { diffWorkspace, localWorkspaceRows, remoteWorkspaceRows, toMirrorPayload, handleOfBot } from './fleetDiff'
