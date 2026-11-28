/**
 * Bridge calls and local workspace rows behind the one-click expansion panel.
 */
import { getBridge } from '@/lib/bridge'
import { useBotStore } from '@/store/botStore'
import { loadMirrorSettings, mirrorWorkspaceToVps, saveMirrorSettings } from '@/lib/remoteMirror'
import {
  defaultRegisterCount,
  diffWorkspace,
  localWorkspaceRows,
  remoteWorkspaceRows,
  type FleetLocalRow,
  type FleetPlan,
  type FleetPlanRequest,
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

/** Compact one-line summary for the plan block. */
export function planHeadline(plan: FleetPlan): string {
  const parts: string[] = []
  if (plan.register_count !== null) parts.push('注册 ' + plan.register_count)
  if (plan.fuel_count !== null) parts.push('燃料号 ' + plan.fuel_count)
  if (plan.expected_pro2 !== null) parts.push('预计 Pro2 ' + plan.expected_pro2)
  if (plan.inviter_gap !== null) parts.push('邀请人缺口 ' + plan.inviter_gap)
  return parts.join(' / ')
}
