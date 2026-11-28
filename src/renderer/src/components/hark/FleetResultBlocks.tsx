/**
 * Read-only result blocks for the fleet expansion panel.
 */
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import {
  firstFailedStage,
  probeIsStale,
  snapshotAge,
  stalledAtFirstStage,
  type FleetPlan,
  type FleetStage,
  type FleetStatus
} from '@shared/fleet'
import {
  planHeadline,
  registerChannelView,
  stageTierText,
  tierSourceNotice,
  type LocalRemoteDiff
} from '@/lib/fleetPanel'

const LIST_LIMIT = 8

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

/** Plan card: pool numbers, quota freshness and the register channel verdict. */
export function FleetPlanBlock({ plan }: { plan: FleetPlan }) {
  return (
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
          {plan.quota.stale ? ' (已过期, 不是当天实测)' : ''}
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
  )
}

/** Job card: per stage outcome and the raw failure text. */
export function FleetStatusBlock({ status }: { status: FleetStatus }) {
  return (
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
            {stageTierText(stage) !== null && (
              <span className="basis-full text-ink-muted">{stageTierText(stage)}</span>
            )}
          </li>
        ))}
      </ul>
      {status.error && <div className="mt-1 text-[10px] text-status-error">{status.error}</div>}
    </div>
  )
}

/** Diff card: what differs between the local bots and the VPS workspace. */
export function FleetDiffBlock({ diff }: { diff: LocalRemoteDiff }) {
  return (
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
  )
}
