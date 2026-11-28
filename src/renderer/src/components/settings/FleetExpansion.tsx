import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  CloudDownload,
  CloudUpload,
  ListChecks,
  Play,
  RefreshCw,
  Rocket
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  FLEET_DEFAULT_DELAY,
  FLEET_DEFAULT_FUEL_PER_INVITER,
  FLEET_DEFAULT_PREFIX,
  FLEET_DEFAULT_SHOW_RATE,
  FLEET_DEFAULT_TARGET_PRO2,
  firstFailedStage,
  probeIsStale,
  snapshotAge,
  stalledAtFirstStage,
  type FleetPlan,
  type FleetStage,
  type FleetStatus
} from '@shared/fleet'
import {
  buildRunRequest,
  compareWithVps,
  loadFleetPlan,
  loadFleetStatus,
  localSnapshot,
  nextRegisterText,
  planHeadline,
  registerChannelView,
  tierSourceNotice,
  startFleetJob,
  suggestRegisterCount,
  syncLocalToVps,
  type LocalRemoteDiff
} from '@/lib/fleetPanel'

const POLL_MS = 4000
const LIST_LIMIT = 8

interface PanelConfig {
  targetPro2: number
  inviterCount: string
  registerCount: string
  fuelPerInviter: number
  prefix: string
  delay: number
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
  showRate: FLEET_DEFAULT_SHOW_RATE,
  dryRun: false
}

function toInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function stageTone(status: string): string {
  if (status === 'ok') return 'text-status-online'
  if (status === 'failed') return 'text-status-error'
  if (status === 'running') return 'text-ink'
  return 'text-ink-muted'
}

function stageCounts(stage: FleetStage): string {
  const parts: string[] = []
  if (stage.success !== null) parts.push('成功 ' + stage.success)
  if (stage.failed !== null) parts.push('失败 ' + stage.failed)
  if (stage.total !== null) parts.push('总数 ' + stage.total)
  return parts.join(' / ')
}

function Field(props: {
  label: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  hint?: string
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
      {props.hint ? <span className="text-[10px] text-ink-muted">{props.hint}</span> : null}
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
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={busy !== ''} onClick={() => void runPlan(false)}>
          <ListChecks className={'size-3.5' + (busy === 'plan' ? ' animate-spin' : '')} />
          读取计划
        </Button>
        <Button variant="secondary" size="sm" disabled={busy !== ''} onClick={() => void runPlan(true)}>
          <RefreshCw className={'size-3.5' + (busy === 'refresh' ? ' animate-spin' : '')} />
          {busy === 'refresh' ? '重扫中...' : '刷新盘点'}
        </Button>
        <Button variant="primary" size="sm" disabled={busy !== ''} onClick={() => void runJob(false)}>
          <Play className="size-3.5" />
          {busy === 'run' ? '提交中...' : '开始扩容'}
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

      {plan && (
        <div className="mt-3 rounded-lg border border-line bg-canvas p-2.5">
          <div className="text-[11px] text-ink">{planHeadline(plan) || '计划暂无数字'}</div>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-ink-muted sm:grid-cols-4">
            <span>池账号 {plan.pool_accounts ?? '-'}</span>
            <span>Pro2 {plan.pro2_count ?? '-'}</span>
            <span>Pro1 {plan.pro1_count ?? '-'}</span>
            <span>未测档 {plan.unknown ?? '-'}</span>
            <span>可邀请人 {plan.available_count ?? '-'}</span>
            <span>邀请人缺口 {plan.inviter_gap ?? '-'}</span>
            <span>候选邀请人 {plan.candidate_inviters ?? '-'}</span>
            <span>展示率 {plan.show_rate ?? '-'}</span>
            <span>目标缺口 {plan.target_gap ?? '-'}</span>
            <span>被邀请人缺口 {plan.fuel_needed ?? '-'}</span>
            <span>燃料号总数 {plan.fuel_count ?? '-'}</span>
            <span>注册数 {plan.register_count ?? '-'}</span>
            <span>预计 Pro2 {plan.expected_pro2 ?? '-'}</span>
          </div>
          {plan.quota && (
            <div className="mt-1 text-[10px] text-ink-muted">
              额度来源 {plan.quota.source || '-'}, 采样于 {snapshotAge(plan.quota.age_s)}
            </div>
          )}
          {tierSourceNotice(plan) !== null && (
            <div className="text-[10px] text-status-attention">{tierSourceNotice(plan)}</div>
          )}
          <div className={'text-[10px] ' + (probeIsStale(plan.probe) ? 'text-status-attention' : 'text-ink-muted')}>
            邀请人快照 {snapshotAge(plan.probe?.age_s ?? null)}
            {probeIsStale(plan.probe) ? ' (非实时读数, 需要最新请点刷新盘点)' : ' (实时)'}
            {plan.probe?.running ? ', 后台正在重扫' : ''}
          </div>
          {plan.register && registerChannelView(plan.register).tone === 'progress' && (
            <div className="mt-1 text-[10px] text-ink-muted">{registerChannelView(plan.register).text}</div>
          )}
          {plan.register && registerChannelView(plan.register).tone === 'failure' && (
            <div className="mt-1 text-[10px] text-status-error">
              注册通道当前不可用, 非预演作业会停在第一段: {registerChannelView(plan.register).text}
            </div>
          )}
        </div>
      )}

      {status && (
        <div className="mt-3 rounded-lg border border-line bg-canvas p-2.5">
          <div className="mb-1 text-[11px] text-ink">
            作业 {status.job_id || '-'} / 当前阶段 {status.stage || '-'} /{' '}
            {status.running ? '运行中' : '已结束'}
          </div>
          {stalledAtFirstStage(status.stages) && (
            <div className="mb-1 text-[10px] text-status-error">
              作业停在第一段 {status.stages[0]?.name}, 后面各段都没有执行
            </div>
          )}
          <ul className="flex flex-col gap-1">
            {status.stages.map((stage, index) => (
              <li key={stage.name} className="flex flex-wrap items-baseline gap-2 text-[11px]">
                <span className={'font-medium ' + stageTone(stage.status)}>{stage.name}</span>
                <span className="text-ink-muted">{stage.status}</span>
                <span className="text-ink-muted">{stageCounts(stage)}</span>
                {index === firstFailedStage(status.stages) && stage.error && (
                  <span className="basis-full text-status-error">{stage.error}</span>
                )}
                {!stage.error && stage.detail && (
                  <span className="basis-full text-ink-muted">{stage.detail}</span>
                )}
              </li>
            ))}
          </ul>
          {status.error && <div className="mt-1 text-[10px] text-status-error">{status.error}</div>}
        </div>
      )}

      {diff && (
        <div className="mt-3 rounded-lg border border-line bg-canvas p-2.5 text-[11px]">
          <div className="flex flex-wrap items-center gap-2 text-ink">
            {diff.ok ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />}
            本地 {diff.local_accounts} / 远端 {diff.remote_accounts} / 一致 {diff.same}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-x-3 text-[10px] text-ink-muted">
            <span>本地独有 {diff.local_only.length}</span>
            <span>远端独有 {diff.remote_only.length}</span>
            <span>名称差异 {diff.name_diff.length}</span>
            <span>分组差异 {diff.group_diff.length}</span>
          </div>
          {diff.local_only.length > 0 && (
            <div className="mt-1 text-[10px] text-ink-secondary">
              本地独有: {diff.local_only.slice(0, LIST_LIMIT).join(', ')}
            </div>
          )}
          {diff.remote_only.length > 0 && (
            <div className="text-[10px] text-ink-secondary">
              远端独有: {diff.remote_only.slice(0, LIST_LIMIT).join(', ')}
            </div>
          )}
          {diff.name_diff.slice(0, LIST_LIMIT).map((row) => (
            <div key={'n' + row.email} className="text-[10px] text-ink-secondary">
              名称 {row.email}: 本地 {row.local || '-'} / 远端 {row.remote || '-'}
            </div>
          ))}
          {diff.group_diff.slice(0, LIST_LIMIT).map((row) => (
            <div key={'g' + row.email} className="text-[10px] text-ink-secondary">
              分组 {row.email}: 本地 {row.local || '-'} / 远端 {row.remote || '-'}
            </div>
          ))}
          <div className="mt-1 text-[10px] text-ink-muted">
            远端分组: {diff.remote_groups.join(', ') || '-'}
          </div>
        </div>
      )}

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
