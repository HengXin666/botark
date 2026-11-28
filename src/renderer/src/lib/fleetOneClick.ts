/**
 * One-click fleet expansion: run plan, expand, verify and report as one flow.
 */
import {
  compareWithVps,
  loadFleetPlan,
  loadFleetStatus,
  mirrorIsOld,
  registerChannelView,
  startFleetJob,
  syncLocalToVps,
  unmaterializedBots,
  type LocalRemoteDiff,
  type MirrorOutcome
} from '@/lib/fleetPanel'
import {
  firstFailedStage,
  type FleetPlan,
  type FleetPlanRequest,
  type FleetRunRequest,
  type FleetStatus
} from '@shared/fleet'

/** What an instance that never materializes the metadata patch forces the operator to run. */
export const OLD_MIRROR_LINE =
  'VPS 镜像为旧版, 名称与分组无法物化 (账号已导入). 需在宿主执行: git pull --ff-only && docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build'

export type OneClickStep = 'plan' | 'expand' | 'verify' | 'sync' | 'done'

export type OneClickTone = 'busy' | 'ok' | 'failed'

export interface OneClickState {
  tone: OneClickTone
  step: OneClickStep
  line: string
}

export interface OneClickPorts {
  loadPlan: (request: FleetPlanRequest) => Promise<FleetPlan>
  startJob: (request: FleetRunRequest) => Promise<{ job_id: string; already_running: boolean; running: boolean }>
  pollStatus: () => Promise<FleetStatus>
  syncToVps: (onProgress?: (line: string) => void) => Promise<MirrorOutcome>
  compare: () => Promise<LocalRemoteDiff>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export interface OneClickInput {
  plan: FleetPlanRequest
  run: FleetRunRequest
  pollMs: number
  jobTimeoutMs: number
}

export interface OneClickHandlers {
  onState: (state: OneClickState) => void
  onTrace: (line: string) => void
  onPlan: (plan: FleetPlan) => void
  onStatus: (status: FleetStatus) => void
  onDiff: (diff: LocalRemoteDiff | null) => void
}

/** Production ports wired to the bridge and the local store. */
export const LIVE_PORTS: OneClickPorts = {
  loadPlan: loadFleetPlan,
  startJob: startFleetJob,
  pollStatus: loadFleetStatus,
  syncToVps: syncLocalToVps,
  compare: compareWithVps,
  sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
  now: () => Date.now()
}

/** Running state so a second click joins the job already in flight. */
let inFlight: Promise<OneClickState> | null = null

export function oneClickBusy(): boolean {
  return inFlight !== null
}

export function resetOneClick(): void {
  inFlight = null
}

function state(step: OneClickStep, tone: OneClickTone, line: string): OneClickState {
  return { step, tone, line }
}

function failureLine(status: FleetStatus): string {
  const failed = firstFailedStage(status.stages)
  if (failed >= 0) {
    const stage = status.stages[failed]
    const reason = stage?.error?.trim() || stage?.detail?.trim() || '没有错误文本'
    return '作业在 ' + (stage?.name || '未知') + ' 段失败: ' + reason
  }
  return status.error.trim() || '作业结束但没有成功'
}

/** Run the whole expansion flow, refusing to start twice at the same time. */
export function runOneClick(
  input: OneClickInput,
  handlers: OneClickHandlers,
  ports: OneClickPorts = LIVE_PORTS
): Promise<OneClickState> {
  if (inFlight) return inFlight
  inFlight = execute(input, ports, handlers).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function execute(input: OneClickInput, ports: OneClickPorts, handlers: OneClickHandlers): Promise<OneClickState> {
  const emit = (next: OneClickState): OneClickState => {
    handlers.onState(next)
    return next
  }
  try {
    handlers.onDiff(null)
    emit(state('plan', 'busy', '正在读取网关计划...'))
    const plan = await ports.loadPlan(input.plan)
    handlers.onPlan(plan)
    if (!plan.ok) {
      handlers.onTrace('plan 失败: ' + plan.error)
      return emit(state('plan', 'failed', '计划读取失败, 未发起作业: ' + (plan.error || '网关未返回原因')))
    }

    const channel = registerChannelView(plan.register)
    if (channel.tone === 'failure') {
      handlers.onTrace('注册通道不可用: ' + channel.text)
      return emit(state('plan', 'failed', '注册通道不可用, 未发起作业: ' + channel.text))
    }

    emit(state('expand', 'busy', '正在发起扩容作业...'))
    const reply = await ports.startJob(input.run)
    const jobId = reply.job_id
    handlers.onTrace(reply.already_running ? '已有作业在跑, 直接接上: ' + jobId : '作业已发起: ' + jobId)

    emit(state('expand', 'busy', '扩容作业进行中, 等待注册与邀请升级...'))
    return await waitForJob(input, ports, handlers, jobId, emit)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    handlers.onTrace('一键流程异常: ' + message)
    return emit(state('expand', 'failed', '一键流程中断: ' + message))
  }
}

async function waitForJob(
  input: OneClickInput,
  ports: OneClickPorts,
  handlers: OneClickHandlers,
  jobId: string,
  emit: (next: OneClickState) => OneClickState
): Promise<OneClickState> {
  const started = ports.now()
  let status = await ports.pollStatus()
  for (;;) {
    handlers.onStatus(status)
    if (!status.running) break
    if (ports.now() - started > input.jobTimeoutMs) {
      return emit(state('expand', 'failed', '作业超时未结束, 已停止等待: ' + jobId))
    }
    const stage = status.stage || '等待中'
    emit(state('expand', 'busy', '扩容作业进行中, 当前阶段 ' + stage))
    await ports.sleep(input.pollMs)
    status = await ports.pollStatus()
  }
  handlers.onStatus(status)
  if (!status.ok) {
    const line = failureLine(status)
    handlers.onTrace('作业失败: ' + line)
    return emit(state('expand', 'failed', line + ', 已停止, 没有同步不完整的池'))
  }

  return await finish(ports, handlers, emit)
}

async function finish(
  ports: OneClickPorts,
  handlers: OneClickHandlers,
  emit: (next: OneClickState) => OneClickState
): Promise<OneClickState> {
  try {
    emit(state('sync', 'busy', '扩容完成, 正在同步到 VPS...'))
    const synced = await ports.syncToVps((line) => handlers.onTrace(line))
    const old = mirrorIsOld(synced.counts)
    emit(state('verify', 'busy', old ? '远端正跑旧版镜像, 正在核对账号是否导入...' : '同步完成, 正在校验双端一致...'))
    const diff = await ports.compare()
    handlers.onDiff(diff)
    const forgotten = unmaterializedBots(diff)
    if (old) {
      handlers.onTrace('远端 metadata 只回 ok, 没有计数键, 判定为旧版镜像')
      const line =
        forgotten > 0 ? '远端有 ' + forgotten + ' 个账号未物化为 bot, 属旧版镜像行为. ' + OLD_MIRROR_LINE : OLD_MIRROR_LINE
      return emit(state('verify', 'failed', line))
    }
    if (!diff.ok) {
      const parts: string[] = []
      if (diff.local_only.length > 0) parts.push('本地独有 ' + diff.local_only.length)
      if (diff.remote_only.length > 0) parts.push('远端独有 ' + diff.remote_only.length)
      if (diff.name_diff.length > 0) parts.push('名称差异 ' + diff.name_diff.length)
      if (diff.group_diff.length > 0) parts.push('分组差异 ' + diff.group_diff.length)
      return emit(state('verify', 'failed', '双端不一致: ' + parts.join(', ')))
    }
    handlers.onTrace('双端一致, 一键流程完成')
    return emit(state('done', 'ok', '扩容已完成, 账号与分组已同步且双端一致'))
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    handlers.onTrace('同步或校验失败: ' + message)
    return emit(state('sync', 'failed', '扩容已完成但同步失败: ' + message + ', 可点同步到 VPS 重试'))
  }
}
