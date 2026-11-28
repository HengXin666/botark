/**
 * Snapshot freshness and stage failure helpers for the fleet panel.
 */
import { STALE_AFTER_S, type FleetProbeInfo, type FleetStage } from './fleet'

/** Human readable age of a snapshot, so a stale reading is never shown as live. */
export function snapshotAge(ageSeconds: number | null): string {
  if (ageSeconds === null) return '采样时间未知'
  const seconds = Math.max(0, Math.round(ageSeconds))
  if (seconds < 60) return seconds + ' 秒前'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return minutes + ' 分钟前'
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours + ' 小时前'
  return Math.round(hours / 24) + ' 天前'
}

/** True when the inviter snapshot is old enough that it must be labelled stale. */
export function probeIsStale(probe: FleetProbeInfo | null): boolean {
  if (!probe) return true
  return probe.stale || probe.age_s === null || probe.age_s > STALE_AFTER_S
}

/** Stage index that failed first, or -1 when no stage reported a failure. */
export function firstFailedStage(stages: FleetStage[]): number {
  for (let index = 0; index < stages.length; index += 1) {
    if (stages[index]?.status === 'failed') return index
  }
  return -1
}

/** True when the job stopped at its first stage and later stages never ran. */
export function stalledAtFirstStage(stages: FleetStage[]): boolean {
  const failed = firstFailedStage(stages)
  if (failed !== 0) return false
  return stages.every((stage, index) => index === 0 || stage.status === 'pending')
}
