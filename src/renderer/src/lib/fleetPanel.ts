/**
 * Bridge calls and local workspace rows behind the one-click expansion panel.
 */
import { getBridge } from '@/lib/bridge'
import { useBotStore } from '@/store/botStore'
import { loadMirrorSettings, mirrorWorkspaceToVps, saveMirrorSettings } from '@/lib/remoteMirror'
import {
  FLEET_DEFAULT_DELAY,
  FLEET_MAX_ADD,
  FLEET_MAX_DELAY,
  FLEET_MIN_ADD,
  FLEET_MIN_DELAY,
  STALE_AFTER_S,
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
  type FleetStage,
  type FleetStatus,
  type WorkspaceDiff
} from '@shared/fleet'
import type { HarkMirrorCounts } from '@shared/ipc'

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
export async function syncLocalToVps(onProgress?: (line: string) => void): Promise<MirrorOutcome> {
  const snapshot = localSnapshot()
  if (snapshot.rows.length === 0) throw new Error('本地没有 Hark bot 可同步')
  await resolveMirrorTarget()
  onProgress?.('正在推送 ' + snapshot.rows.length + ' 个 Hark bot 到 VPS...')
  return mirrorWorkspaceToVps(onProgress)
}

export interface MirrorOutcome {
  accounts: number
  imported: number
  failed: number
  groups: number
  bots: number
  counts: HarkMirrorCounts | null
}

/**
 * The metadata patch of an instance that predates the counter reply answers ok
 * only, so the panel can name that case instead of reporting a clean sync.
 */
export function mirrorIsOld(counts: HarkMirrorCounts | null): boolean {
  return counts === null
}

/**
 * How many remote accounts have no bot behind them. An instance that answers the
 * metadata patch without counters never materializes it while no renderer is
 * alive, so this gap is that instance being old rather than a mismatch.
 */
export function unmaterializedBots(diff: LocalRemoteDiff): number {
  return Math.max(0, diff.remote_accounts - diff.remote_bots)
}

export interface LocalRemoteDiff extends WorkspaceDiff {
  remote_groups: string[]
  local_groups: string[]
  remote_bots: number
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
    local_groups: local.groups.map((group) => group.name),
    remote_bots: remote.bots.length
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

export interface RunRequestInput {
  add: number
  delay: number
  plan: FleetPlan | null
  planAddAware: boolean
  dryRun: boolean
}

/**
 * Build the run payload from the two settings the panel keeps. An instance that
 * does not read the add field would treat an absent target as its own default,
 * so that case carries the plan numbers the add value was meant to shift.
 */
export function buildRunRequest(input: RunRequestInput): FleetRunRequest {
  const add = clampAdd(input.add)
  const request: FleetRunRequest = { delay: clampDelay(input.delay), dry_run: input.dryRun }
  if (input.planAddAware) {
    request.add = add
    return request
  }
  const plan = input.plan
  const target = (plan?.derived_target_pro2 ?? plan?.target_pro2 ?? 0) + add
  request.target_pro2 = Math.max(1, Math.trunc(target))
  const have = plan?.inviter_have
  if (have !== null && have !== undefined) request.inviter_count = Math.max(1, Math.trunc(have + add))
  return request
}

/** Keep the add value inside the range the gateway accepts. */
export function clampAdd(value: number): number {
  const parsed = Math.trunc(Number(value))
  if (!Number.isFinite(parsed)) return FLEET_MIN_ADD
  return Math.min(FLEET_MAX_ADD, Math.max(FLEET_MIN_ADD, parsed))
}

/** Keep the delay inside the range the gateway accepts. */
export function clampDelay(value: number): number {
  const parsed = Math.trunc(Number(value))
  if (!Number.isFinite(parsed)) return FLEET_DEFAULT_DELAY
  return Math.min(FLEET_MAX_DELAY, Math.max(FLEET_MIN_DELAY, parsed))
}

/**
 * One readonly line saying what this click will do: where the Pro2 count stands
 * and how many accounts the gateway would register.
 */
export function expansionSummary(plan: FleetPlan | null, add: number): string {
  if (!plan) return '还没读到网关计划, 点一次就能看到本次会注册几个号'
  const now = plan.pro2_count ?? 0
  const target = (plan.derived_target_pro2 ?? plan.target_pro2 ?? 0) + add
  const register = plan.register_count
  const head = '当前 Pro2 ' + now + ' -> 目标 ' + target
  if (register === null || register === undefined) return head
  if (register === 0) return head + ' / 本次不需注册新号'
  return head + ' / 本次将注册 ' + register + ' 个号'
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
 * Describe the measured tiers of a stage. A stage without readable tier data
 * must never read as zero successes, so the unavailable case says so explicitly.
 */
export function stageTierText(stage: FleetStage): string | null {
  const tiers = stage.tiers
  if (!tiers) return null
  if (!tiers.available) return '档位数据未产生 (不能据此判断成功数量)'
  const parts: string[] = []
  if (tiers.pro2 !== null) parts.push('Pro2 ' + tiers.pro2)
  if (tiers.pro1 !== null) parts.push('Pro1 ' + tiers.pro1)
  if (tiers.skip !== null && tiers.skip > 0) parts.push('免费档 ' + tiers.skip)
  if (tiers.unknown !== null && tiers.unknown > 0) parts.push('未知档 ' + tiers.unknown)
  if (tiers.failed !== null && tiers.failed > 0) parts.push('失败 ' + tiers.failed)
  if (parts.length === 0) return '实测档位为空'
  const head = '实测档位: ' + parts.join(' / ')
  return tiers.skip !== null && tiers.skip > 0
    ? head + ' (免费档注册成功但额度不足, 不能当满血号用)'
    : head
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
  if (plan.skip_count !== null && plan.skip_count > 0) parts.push('池内免费档 ' + plan.skip_count)
  return parts.join(' / ')
}
