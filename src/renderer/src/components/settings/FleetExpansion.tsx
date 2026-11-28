import { useEffect, useRef, useState } from 'react'
import {
  CloudDownload,
  CloudUpload,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  Rocket,
  Zap,
  AlertCircle,
  CheckCircle2
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  FLEET_DEFAULT_DELAY,
  FLEET_MAX_ADD,
  FLEET_MAX_DELAY,
  FLEET_MIN_ADD,
  FLEET_MIN_DELAY,
  type FleetPlan,
  type FleetPlanRequest,
  type FleetStatus
} from '@shared/fleet'
import {
  buildRunRequest,
  clampAdd,
  clampDelay,
  compareWithVps,
  expansionSummary,
  loadFleetPlan,
  loadFleetStatus,
  localSnapshot,
  startFleetJob,
  syncLocalToVps,
  type LocalRemoteDiff
} from '@/lib/fleetPanel'
import { oneClickBusy, runOneClick, type OneClickState } from '@/lib/fleetOneClick'
import { FleetDiffBlock, FleetPlanBlock, FleetStatusBlock } from '@/components/hark/FleetResultBlocks'

const POLL_MS = 4000
const ONE_CLICK_TIMEOUT_MS = 45 * 60 * 1000
const LIST_LIMIT = 8
/** True when the plan answered the add field instead of a plain target. */
function planReadsAdd(plan: FleetPlan): boolean {
  return typeof plan.derived_target_pro2 === 'number'
}

/**
 * Plan request for an instance that does not read add: the target and inviter
 * count are spelled out so the add value still moves the pool forward.
 */
function planRequestFrom(plan: FleetPlan | null, add: number, refresh = false): FleetPlanRequest {
  const target = (plan?.target_pro2 ?? 0) + add
  const request: FleetPlanRequest = { target_pro2: Math.max(1, Math.trunc(target)) }
  const have = plan?.inviter_have
  if (have !== null && have !== undefined) request.inviter_count = Math.max(1, Math.trunc(have + add))
  if (refresh) request.refresh = true
  return request
}

const ONECLICK_STEP_LABEL: Record<string, string> = {
  plan: '读计划',
  expand: '扩容',
  import: '导入本地',
  sync: '同步 VPS',
  verify: '校验',
  done: '完成'
}

interface PanelConfig {
  add: number
  delay: number
}

const DEFAULT_CONFIG: PanelConfig = { add: FLEET_MIN_ADD, delay: FLEET_DEFAULT_DELAY }

function toInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function Field(props: {
  label: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  hint?: string
  tone?: 'muted' | 'warn'
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] text-ink-muted">{props.label}</span>
      <input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        inputMode="numeric"
        spellCheck={false}
        className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 font-mono text-[12px] text-ink"
      />
      {props.hint ? (
        <span className={'text-[10px] ' + (props.tone === 'warn' ? 'text-status-attention' : 'text-ink-muted')}>
          {props.hint}
        </span>
      ) : null}
    </label>
  )
}

/** One click: plan, run and watch the gateway Pro2 expansion job. */
export function FleetExpansion() {
  const [config, setConfig] = useState<PanelConfig>(DEFAULT_CONFIG)
  const [planAddAware, setPlanAddAware] = useState(true)
  const [plan, setPlan] = useState<FleetPlan | null>(null)
  const [status, setStatus] = useState<FleetStatus | null>(null)
  const [diff, setDiff] = useState<LocalRemoteDiff | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [trace, setTrace] = useState<string[]>([])
  const [oneClick, setOneClick] = useState<OneClickState | null>(null)
  const pollRef = useRef<number | null>(null)

  const push = (line: string): void => setTrace((rows) => [...rows.slice(-LIST_LIMIT * 3), line])

  useEffect(() => {
    let alive = true
    void loadFleetStatus()
      .then((next) => {
        if (!alive) return
        setStatus(next)
        if (next.running) watch(next.job_id)
      })
      .catch(() => undefined)
    return () => {
      alive = false
      if (pollRef.current !== null) window.clearTimeout(pollRef.current)
    }
  }, [])

  const patch = (next: Partial<PanelConfig>): void => setConfig((current) => ({ ...current, ...next }))

  const startOneClick = (): void => {
    if (oneClickBusy()) return
    setError('')
    setTrace([])
    setBusy('oneclick')
    const add = clampAdd(config.add)
    void runOneClick(
      {
        plan: planAddAware ? { add } : plan ? planRequestFrom(plan, add) : { add },
        run: buildRunRequest({ add, delay: clampDelay(config.delay), plan, planAddAware, dryRun: false }),
        pollMs: POLL_MS,
        jobTimeoutMs: ONE_CLICK_TIMEOUT_MS
      },
      {
        onState: setOneClick,
        onTrace: push,
        onPlan: setPlan,
        onStatus: setStatus,
        onDiff: (next) => setDiff(next)
      }
    ).finally(() => setBusy(''))
  }

  const fetchPlan = async (refresh = false): Promise<FleetPlan> => {
    const add = clampAdd(config.add)
    let aware = planAddAware
    let next = await loadFleetPlan(aware ? { add, refresh } : planRequestFrom(plan, add, refresh))
    if (aware && !planReadsAdd(next)) {
      aware = false
      setPlanAddAware(false)
      next = await loadFleetPlan(planRequestFrom(next, add, refresh))
    }
    setPlan(next)
    if (!next.ok) setError(next.error || '网关 plan 未返回 ok')
    return next
  }

  const runPlan = async (refresh = false): Promise<void> => {
    setBusy(refresh ? 'refresh' : 'plan')
    setError('')
    try {
      const next = await fetchPlan(refresh)
      if (refresh && next.probe?.running) push('已触发后台重扫, 稍后再读计划可看到新读数')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy('')
    }
  }

  const watch = (jobId: string): void => {
    const tick = async (): Promise<void> => {
      try {
        const next = await loadFleetStatus()
        setStatus(next)
        if (next.error) setError(next.error)
        if (!next.running) {
          pollRef.current = null
          push('作业 ' + (next.job_id || jobId) + ' 已结束, 阶段 ' + (next.stage || '-'))
          return
        }
        pollRef.current = window.setTimeout(() => void tick(), POLL_MS)
      } catch (cause) {
        pollRef.current = null
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    pollRef.current = window.setTimeout(() => void tick(), POLL_MS)
  }

  const runJob = async (dryRun: boolean): Promise<void> => {
    setBusy('run')
    setError('')
    setTrace([])
    try {
      const planned = plan ?? (await fetchPlan())
      if (!planned.ok) throw new Error(planned.error || 'plan 未就绪, 不发起 run')
      const request = buildRunRequest({
        add: clampAdd(config.add),
        delay: clampDelay(config.delay),
        plan: planned,
        planAddAware,
        dryRun
      })
      push('提交 ' + (dryRun ? '预演' : '扩容') + ' 作业: ' + JSON.stringify(request))
      const reply = await startFleetJob(request)
      if (reply.already_running) {
        const live = await loadFleetStatus()
        setStatus(live)
        setError('网关已有作业在跑: ' + (live.job_id || reply.job_id) + ' (阶段 ' + (live.stage || '-') + ')')
        if (live.running) watch(live.job_id)
        return
      }
      setStatus({
        ok: reply.ok,
        job_id: reply.job_id,
        running: reply.running,
        dry_run: reply.dry_run,
        stage: reply.stages[0]?.stage ?? '',
        stages: reply.stages,
        summary: {},
        error: reply.error
      })
      if (!reply.ok) setError(reply.error || 'run 返回失败')
      if (reply.job_id) watch(reply.job_id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy('')
    }
  }

  const sync = async (): Promise<void> => {
    setBusy('sync')
    setError('')
    try {
      const result = await syncLocalToVps(push)
      push(
        '同步完成: bot ' + result.bots + ', 分组 ' + result.groups + ', 新导入 ' + result.imported + ', 失败 ' + result.failed
      )
      if (result.failed > 0) setError('有账号缺 session_token 或远端拒绝, 见 VPS 账号列表')
      const next = await compareWithVps(push)
      setDiff(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy('')
    }
  }

  const compare = async (): Promise<void> => {
    setBusy('diff')
    setError('')
    try {
      const next = await compareWithVps(push)
      setDiff(next)
      if (!next.ok) push('双端不一致, 见下方差异明细')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy('')
    }
  }

  const localCount = (() => {
    try {
      return localSnapshot().rows.length
    } catch {
      return 0
    }
  })()

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="text-[13px] font-medium text-ink">Hark 号池一键扩容</span>
          <p className="mt-0.5 text-[11px] text-ink-secondary">
            填两个数就行: 要新增几个 Pro2, 和每个号之间等几秒. 其余参数由网关按号池现状算.
          </p>
        </div>
        <span className="text-[11px] text-ink-muted">本地 Hark bot {localCount}</span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field
          label="新增 Pro2 数量"
          value={String(config.add)}
          hint={'范围 ' + FLEET_MIN_ADD + '..' + FLEET_MAX_ADD}
          onChange={(next) => patch({ add: toInt(next, FLEET_MIN_ADD) })}
        />
        <Field
          label="注册间隔(秒)"
          value={String(config.delay)}
          hint={'范围 ' + FLEET_MIN_DELAY + '..' + FLEET_MAX_DELAY}
          onChange={(next) => patch({ delay: toInt(next, FLEET_DEFAULT_DELAY) })}
        />
      </div>

      <p className="mt-2 text-[11px] text-ink-secondary">{expansionSummary(plan, clampAdd(config.add))}</p>

      {oneClick && (
        <div
          className={
            'mt-3 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ' +
            (oneClick.tone === 'failed'
              ? 'border-status-error/40 bg-status-error/5 text-status-error'
              : oneClick.tone === 'ok'
                ? 'border-status-online/40 bg-status-online/5 text-status-online'
                : 'border-line bg-canvas text-ink')
          }
        >
          {oneClick.tone === 'busy' && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
          {oneClick.tone === 'ok' && <CheckCircle2 className="size-3.5 shrink-0" />}
          {oneClick.tone === 'failed' && <AlertCircle className="size-3.5 shrink-0" />}
          <span className="min-w-0 flex-1">{oneClick.line}</span>
          <span className="shrink-0 text-[10px] text-ink-muted">{ONECLICK_STEP_LABEL[oneClick.step]}</span>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          className="min-w-[168px]"
          disabled={busy !== ''}
          onClick={startOneClick}
        >
          {busy === 'oneclick' ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
          {busy === 'oneclick' ? '一键流程进行中...' : '一键完成扩容'}
        </Button>
        <Button variant="secondary" size="sm" disabled={busy !== ''} onClick={() => void runPlan(false)}>
          <ListChecks className={'size-3.5' + (busy === 'plan' ? ' animate-spin' : '')} />
          读取计划
        </Button>
        <Button variant="secondary" size="sm" disabled={busy !== ''} onClick={() => void runPlan(true)}>
          <RefreshCw className={'size-3.5' + (busy === 'refresh' ? ' animate-spin' : '')} />
          {busy === 'refresh' ? '重扫中...' : '刷新盘点'}
        </Button>
        <Button variant="secondary" size="sm" disabled={busy !== ''} onClick={() => void runJob(false)}>
          <Play className="size-3.5" />
          {busy === 'run' ? '提交中...' : '仅发起扩容'}
        </Button>
        <Button variant="secondary" size="sm" disabled={busy !== ''} onClick={() => void runJob(true)}>
          <Rocket className="size-3.5" />
          预演
        </Button>
        <Button variant="secondary" size="sm" disabled={busy !== ''} onClick={() => void sync()}>
          <CloudUpload className="size-3.5" />
          {busy === 'sync' ? '同步中...' : '同步到 VPS'}
        </Button>
        <Button variant="secondary" size="sm" disabled={busy !== ''} onClick={() => void compare()}>
          <CloudDownload className="size-3.5" />
          {busy === 'diff' ? '校验中...' : '校验双端一致'}
        </Button>
      </div>

      {plan && <FleetPlanBlock plan={plan} />}

      {status && <FleetStatusBlock status={status} />}

      {diff && <FleetDiffBlock diff={diff} />}

      {trace.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5">
          {trace.map((line, index) => (
            <li key={index} className="font-mono text-[10px] text-ink-muted">
              {line}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <span className="mt-2 inline-flex items-start gap-1 text-[11px] text-status-error">
          <AlertCircle className="mt-0.5 size-3 shrink-0" /> {error}
        </span>
      )}
    </div>
  )
}