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
  FLEET_DEFAULT_FUEL_PER_INVITER,
  FLEET_DEFAULT_PREFIX,
  FLEET_DEFAULT_SHOW_RATE,
  FLEET_DEFAULT_TARGET_PRO2,
  probeIsStale,
  type FleetPlan,
  type FleetStatus
} from '@shared/fleet'
import {
  buildRunRequest,
  compareWithVps,
  loadFleetPlan,
  loadFleetStatus,
  inviterFieldHint,
  localSnapshot,
  nextRegisterText,
  startFleetJob,
  suggestRegisterCount,
  syncLocalToVps,
  type LocalRemoteDiff
} from '@/lib/fleetPanel'
import { oneClickBusy, runOneClick, type OneClickState } from '@/lib/fleetOneClick'
import { FleetDiffBlock, FleetPlanBlock, FleetStatusBlock } from '@/components/hark/FleetResultBlocks'

const POLL_MS = 4000
const ONE_CLICK_TIMEOUT_MS = 45 * 60 * 1000
const LIST_LIMIT = 8
const ONECLICK_STEP_LABEL: Record<string, string> = {
  plan: '读计划',
  expand: '扩容',
  sync: '同步 VPS',
  verify: '校验',
  done: '完成'
}

interface PanelConfig {
  targetPro2: number
  inviterCount: string
  registerCount: string
  fuelPerInviter: number
  prefix: string
  delay: number
  domains: string
  showRate: number
  dryRun: boolean
}

const DEFAULT_CONFIG: PanelConfig = {
  targetPro2: FLEET_DEFAULT_TARGET_PRO2,
  inviterCount: '',
  registerCount: String(suggestRegisterCount(FLEET_DEFAULT_TARGET_PRO2, FLEET_DEFAULT_FUEL_PER_INVITER)),
  fuelPerInviter: FLEET_DEFAULT_FUEL_PER_INVITER,
  prefix: FLEET_DEFAULT_PREFIX,
  delay: FLEET_DEFAULT_DELAY,
  domains: '',
  showRate: FLEET_DEFAULT_SHOW_RATE,
  dryRun: false
}

function toInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
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
  const [registerTouched, setRegisterTouched] = useState(false)
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
    void runOneClick(
      {
        plan: {
          target_pro2: toInt(String(config.targetPro2), FLEET_DEFAULT_TARGET_PRO2),
          inviter_count: config.inviterCount.trim() === '' ? undefined : toInt(config.inviterCount, 0),
          show_rate: config.showRate
        },
        run: buildRunRequest({
          targetPro2: toInt(String(config.targetPro2), FLEET_DEFAULT_TARGET_PRO2),
          inviterCount: config.inviterCount,
          registerCount: config.registerCount,
          registerTouched,
          fuelPerInviter: config.fuelPerInviter,
          prefix: config.prefix,
          delay: config.delay,
          domains: config.domains,
          dryRun: false
        }),
        pollMs: POLL_MS,
        jobTimeoutMs: ONE_CLICK_TIMEOUT_MS
      },
      {
        onState: setOneClick,
        onTrace: push,
        onPlan: (next) => {
          setPlan(next)
          setConfig((current) => ({
            ...current,
            registerCount: nextRegisterText(next, registerTouched, current.registerCount)
          }))
        },
        onStatus: setStatus,
        onDiff: (next) => setDiff(next)
      }
    ).finally(() => setBusy(''))
  }

  const fetchPlan = async (refresh = false): Promise<FleetPlan> => {
    const inviter = config.inviterCount.trim() === '' ? undefined : toInt(config.inviterCount, 0)
    const next = await loadFleetPlan({
      target_pro2: toInt(String(config.targetPro2), FLEET_DEFAULT_TARGET_PRO2),
      inviter_count: inviter,
      show_rate: config.showRate,
      refresh
    })
    setPlan(next)
    if (!next.ok) setError(next.error || '网关 plan 未返回 ok')
    setConfig((current) => ({
      ...current,
      registerCount: nextRegisterText(next, registerTouched, current.registerCount)
    }))
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
        targetPro2: toInt(String(config.targetPro2), FLEET_DEFAULT_TARGET_PRO2),
        inviterCount: config.inviterCount,
        registerCount: config.registerCount,
        registerTouched,
        fuelPerInviter: config.fuelPerInviter,
        prefix: config.prefix,
        delay: config.delay,
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
            先向网关要计划, 再发起作业并轮询每个阶段; 同步与一致性校验走 VPS API.
          </p>
        </div>
        <span className="text-[11px] text-ink-muted">本地 Hark bot {localCount}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Field
          label="目标 Pro2 数"
          value={String(config.targetPro2)}
          onChange={(next) => patch({ targetPro2: toInt(next, FLEET_DEFAULT_TARGET_PRO2) })}
        />
        <Field
          label="可用邀请人数"
          value={config.inviterCount}
          placeholder="留空读网关盘点"
          hint={inviterFieldHint(plan)}
          tone={probeIsStale(plan?.probe ?? null) ? 'warn' : 'muted'}
          onChange={(next) => patch({ inviterCount: next })}
        />
        <Field
          label="新注册数量"
          value={config.registerCount}
          hint={registerTouched ? '手填值' : '跟随计划'}
          onChange={(next) => {
            setRegisterTouched(true)
            patch({ registerCount: next })
          }}
        />
        <Field
          label="每人补被邀请人"
          value={String(config.fuelPerInviter)}
          onChange={(next) => patch({ fuelPerInviter: toInt(next, FLEET_DEFAULT_FUEL_PER_INVITER) })}
        />
        <Field
          label="邮箱前缀"
          value={config.prefix}
          onChange={(next) => patch({ prefix: next })}
        />
        <Field
          label="注册间隔(秒)"
          value={String(config.delay)}
          onChange={(next) => patch({ delay: toInt(next, FLEET_DEFAULT_DELAY) })}
        />
        <Field
          label="注册邮箱域"
          value={config.domains}
          placeholder="空=网关自选"
          hint="当前脚本只收第一个域"
          onChange={(next) => patch({ domains: next })}
        />
      </div>

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