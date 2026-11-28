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
  probeIsStale,
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
 * Hint for the inviter count field. A stale probe snapshot reports more open
 * slots than the pool really has, so the field says the number is old instead
 * of letting it read as a live capacity.
 */
export function inviterFieldHint(plan: FleetPlan | null): string {
  if (!plan) return '留空读网关盘点'
  const probe = plan.probe
  if (!probe) return '留空读网关盘点'
  const age = snapshotAge(probe.age_s)
  if (probe.running) return '快照 ' + age + ', 后台正在重扫'
  if (probeIsStale(probe)) return '快照 ' + age + ', 已过期, 名额可能虚高'
  return '快照 ' + age + ', 实时'
}

/** Split a comma separated domain list, dropping blanks and duplicates. */
export function parseDomains(text: string): string[] {
  const seen = new Set<string>()
  for (const part of text.split(',')) {
    const domain = part.trim().toLowerCase()
    if (domain !== '') seen.add(domain)
  }
  return [...seen]
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
  domains?: string
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
  const domains = parseDomains(input.domains ?? '')
  if (domains.length > 0) request.domains = domains
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
