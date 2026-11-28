/**
 * Bridge calls and local workspace rows behind the one-click expansion panel.
 */
import { getBridge } from '@/lib/bridge'
import { useBotStore } from '@/store/botStore'
import { loadMirrorSettings, mirrorWorkspaceToVps, saveMirrorSettings } from '@/lib/remoteMirror'
import {
  FLEET_DEFAULT_PREFIX,
  STALE_AFTER_S,
  defaultRegisterCount,
  snapshotAge,
  diffWorkspace,
  localWorkspaceRows,
  remoteWorkspaceRows,
  type FleetLocalRow,
  type FleetPlan,
  type FleetPlanRequest,
  type FleetRegisterInfo,
  type FleetRunReply,
  type FleetRunRequest,
  type FleetStatus,
  type WorkspaceDiff
} from '@shared/fleet'

export interface LocalSnapshot {
  rows: FleetLocalRow[]
  groups: Array<{ id: string; name: string }>
}

/** Read the local Hark bots with their group names. */
export function localSnapshot(): LocalSnapshot {
  const state = useBotStore.getState()
  const groups = state.groups.map((group) => ({ id: group.id, name: group.name }))
  return { rows: localWorkspaceRows(state.bots, state.accounts, groups), groups }
}

function requireBridge(): NonNullable<ReturnType<typeof getBridge>>['hark'] {
  const bridge = getBridge()?.hark
  if (!bridge) throw new Error('fleet bridge unavailable: run the desktop build')
  return bridge
}

/** Read the gateway plan. */
export async function loadFleetPlan(request: FleetPlanRequest): Promise<FleetPlan> {
  return requireBridge().fleetPlan(request)
}

/** Read the latest gateway fleet job status. */
export async function loadFleetStatus(): Promise<FleetStatus> {
  return requireBridge().fleetStatus()
}

/** Start one gateway fleet job. */
export async function startFleetJob(request: FleetRunRequest): Promise<FleetRunReply> {
  return requireBridge().fleetRun(request)
}

/** Push the local accounts, group names and bot names to the VPS. */
export async function syncLocalToVps(onProgress?: (line: string) => void): Promise<{
  accounts: number
  imported: number
  failed: number
  groups: number
  bots: number
}> {
  const snapshot = localSnapshot()
  if (snapshot.rows.length === 0) throw new Error('本地没有 Hark bot 可同步')
  await resolveMirrorTarget()
  onProgress?.('正在推送 ' + snapshot.rows.length + ' 个 Hark bot 到 VPS...')
  return mirrorWorkspaceToVps(onProgress)
}

export interface LocalRemoteDiff extends WorkspaceDiff {
  remote_groups: string[]
  local_groups: string[]
}

/** Pull the VPS workspace and diff it against the local Hark bots. */
export async function compareWithVps(onProgress?: (line: string) => void): Promise<LocalRemoteDiff> {
  const bridge = requireBridge()
  const settings = await resolveMirrorTarget()
  onProgress?.('正在拉取 VPS workspace...')
  const remote = await bridge.mirrorPull(settings)
  onProgress?.('正在比对账号, 名称与分组...')
  const local = localSnapshot()
  const diff = diffWorkspace(local.rows, remoteWorkspaceRows(remote))
  return {
    ...diff,
    remote_groups: remote.groups.map((group) => group.name),
    local_groups: local.groups.map((group) => group.name)
  }
}

async function resolveMirrorTarget(): Promise<{ url: string; token: string }> {
  const saved = loadMirrorSettings()
  if (saved.url && saved.token) return saved
  const bridge = getBridge()?.hark
  if (!bridge?.mirrorSettings) return saved
  const preloaded = await bridge.mirrorSettings()
  if (preloaded.url && preloaded.token) saveMirrorSettings(preloaded)
  return preloaded
}

/** Fuel count the panel fills in when the caller leaves the field empty. */
export function suggestRegisterCount(targetPro2: number, fuelPerInviter: number): number {
  return defaultRegisterCount(targetPro2, fuelPerInviter)
}

/** Input value for the register field: the plan number when known, else the fuel rule. */
export function registerFieldValue(plan: FleetPlan | null, fallback: number): string {
  if (plan?.register_count !== null && plan?.register_count !== undefined) {
    return String(plan.register_count)
  }
  return String(fallback)
}

/**
 * Build the register field text after a plan read: empty when the gateway left
 * the field out, the gateway number otherwise, and untouched when hand edited.
 */
export function nextRegisterText(plan: FleetPlan | null, touched: boolean, current: string): string {
  if (touched) return current
  const planned = plan?.register_count
  if (planned === null || planned === undefined) return ''
  return String(planned)
}

/**
 * Build the run payload. An empty or untouched register field is omitted so the
 * gateway keeps ownership of the fuel rule instead of the panel pinning a value.
 */
export function buildRunRequest(input: {
  targetPro2: number
  inviterCount: string
  registerCount: string
  registerTouched: boolean
  fuelPerInviter: number
  prefix: string
  delay: number
  dryRun: boolean
}): FleetRunRequest {
  const request: FleetRunRequest = {
    target_pro2: input.targetPro2,
    fuel_per_inviter: input.fuelPerInviter,
    prefix: input.prefix.trim() || FLEET_DEFAULT_PREFIX,
    delay: input.delay,
    dry_run: input.dryRun
  }
  const inviter = input.inviterCount.trim()
  if (inviter !== '') request.inviter_count = Math.max(0, Math.trunc(Number(inviter)) || 0)
  const register = input.registerCount.trim()
  if (input.registerTouched && register !== '') {
    request.register_count = Math.max(0, Math.trunc(Number(register)) || 0)
  }
  return request
}

export type RegisterChannelTone = 'hidden' | 'progress' | 'failure'

export interface RegisterChannelView {
  tone: RegisterChannelTone
  text: string
}

/**
 * Turn the gateway verdict into one banner. The verdict is the single source of
 * truth, so a running or stopped batch is never shown as a channel failure.
 */
export function registerChannelView(register: FleetRegisterInfo | null): RegisterChannelView {
  if (!register) return { tone: 'hidden', text: '' }
  const reason = register.reason.trim()
  switch (register.verdict) {
    case 'running':
      return {
        tone: 'progress',
        text: '注册通道正在跑批, 作业 ' + (register.last_job || '-') + ' 还在进行, 不是故障'
      }
    case 'stopped':
      return { tone: 'progress', text: '该批次已被手动停止, 不是通道故障' }
    case 'failed':
      return {
        tone: 'failure',
        text: reason === '' ? '上游未给出失败文本' : reason
      }
    case 'unknown':
      return { tone: 'failure', text: '网关无法判定最近一批的结论' }
    case 'ok':
      return { tone: 'hidden', text: '' }
    default:
      if (register.running) return { tone: 'progress', text: '注册通道正在跑批, 不是故障' }
      if (reason !== '') return { tone: 'failure', text: reason }
      return { tone: 'hidden', text: '' }
  }
}

/**
 * Say how the tier counts were derived. The gateway merges the cached reading
 * with the pool file, so an old cache must not read as a same-day measurement.
 */
export function tierSourceNotice(plan: FleetPlan): string | null {
  const sources = plan.tier_sources
  const derived = sources !== null && (sources.pool !== null || sources.cache !== null)
  if (!derived) return null
  const age = plan.quota?.age_s ?? null
  const parts: string[] = []
  if (sources.cache !== null && sources.pool !== null) {
    parts.push('缓存 ' + sources.cache + ' / 池文件 ' + sources.pool)
  }
  if (sources.none !== null && sources.none > 0) parts.push('无档位 ' + sources.none)
  const origin = '档位由' + (parts.length > 0 ? parts.join(' / ') + ' 合并推出' : '缓存与池文件合并推出')
  if (age === null) return origin + ', 采样时间未知'
  if (age <= STALE_AFTER_S) return origin + ', 读数较新 (额度采样于 ' + snapshotAge(age) + ')'
  return origin + ', 不是当天实测 (额度采样于 ' + snapshotAge(age) + ')'
}

/** Compact one-line summary for the plan block. */
export function planHeadline(plan: FleetPlan): string {
  const parts: string[] = []
  if (plan.register_count === 0) parts.push('注册 0 (网关会跳过注册段)')
  else if (plan.register_count !== null) parts.push('注册 ' + plan.register_count)
  if (plan.fuel_count !== null) parts.push('燃料号 ' + plan.fuel_count)
  if (plan.expected_pro2 !== null) parts.push('预计 Pro2 ' + plan.expected_pro2)
  if (plan.inviter_gap !== null) parts.push('邀请人缺口 ' + plan.inviter_gap)
  return parts.join(' / ')
}
