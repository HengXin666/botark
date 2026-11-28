import { describe, expect, it } from 'vitest'
import {
  buildRunRequest,
  nextRegisterText,
  planHeadline,
  inviterFieldHint,
  mirrorIsOld,
  registerChannelView,
  registerFieldValue,
  stageTierText,
  tierSourceNotice,
  unmaterializedBots
} from './fleetPanel'
import { STALE_AFTER_S, parseFleetPlan, parseFleetRunReply } from '@shared/fleet'

const plan = (registerCount: number | null) =>
  parseFleetPlan({ ok: true, target_pro2: 17, register_count: registerCount, fuel_count: 35 }, 200)

describe('register field and run payload', () => {
  it('follows the gateway plan number until the user edits the field', () => {
    expect(nextRegisterText(plan(35), false, '51')).toBe('35')
    expect(nextRegisterText(plan(13), false, '35')).toBe('13')
  })

  it('leaves the field empty when the gateway omits register_count', () => {
    expect(nextRegisterText(plan(null), false, '51')).toBe('')
    expect(nextRegisterText(null, false, '51')).toBe('')
  })

  it('never overwrites a hand-typed value', () => {
    expect(nextRegisterText(plan(35), true, '0')).toBe('0')
    expect(nextRegisterText(plan(35), true, '9')).toBe('9')
  })

  it('keeps the fuel rule fallback for the untouched initial field', () => {
    expect(registerFieldValue(null, 51)).toBe('51')
    expect(registerFieldValue(plan(35), 51)).toBe('35')
  })

  it('omits register_count so the gateway owns the fuel rule', () => {
    const request = buildRunRequest({
      targetPro2: 17,
      inviterCount: '',
      registerCount: '35',
      registerTouched: false,
      fuelPerInviter: 3,
      prefix: 'hkfz',
      delay: 25,
      dryRun: false
    })
    expect('register_count' in request).toBe(false)
    expect('inviter_count' in request).toBe(false)
    expect(request).toEqual({
      target_pro2: 17,
      fuel_per_inviter: 3,
      prefix: 'hkfz',
      delay: 25,
      dry_run: false
    })
  })

  it('sends an explicit register_count once the user types one', () => {
    const request = buildRunRequest({
      targetPro2: 17,
      inviterCount: '12',
      registerCount: '0',
      registerTouched: true,
      fuelPerInviter: 3,
      prefix: ' hkfz ',
      delay: 25,
      dryRun: true
    })
    expect(request.register_count).toBe(0)
    expect(request.inviter_count).toBe(12)
    expect(request.prefix).toBe('hkfz')
    expect(request.dry_run).toBe(true)
  })

  it('ignores an empty hand-edited field and falls back on the default prefix', () => {
    const request = buildRunRequest({
      targetPro2: 17,
      inviterCount: '',
      registerCount: '   ',
      registerTouched: true,
      fuelPerInviter: 3,
      prefix: '',
      delay: 25,
      dryRun: true
    })
    expect('register_count' in request).toBe(false)
    expect(request.prefix).toBe('hkfz')
  })
})

describe('plan headline wording', () => {
  it('names a zero register count as a skipped stage', () => {
    expect(planHeadline(plan(0))).toContain('注册 0 (网关会跳过注册段)')
    expect(planHeadline(plan(35))).toContain('注册 35')
    expect(planHeadline(plan(null))).not.toContain('注册')
  })
})

describe('regression: gateway fuel fallback shape', () => {
  it('parses a register stage whose total comes from the fallback', () => {
    const reply = parseFleetRunReply(
      {
        ok: true,
        job_id: 'j35',
        running: false,
        dry_run: true,
        stages: [
          {
            name: 'register',
            status: 'ok',
            success: 0,
            failed: 0,
            total: 35,
            error: '',
            detail: 'would register 35 accounts prefix=hkfz delay=25.0'
          }
        ]
      },
      200
    )
    expect(reply.stages[0]?.total).toBe(35)
    expect(reply.stages[0]?.detail).toBe('would register 35 accounts prefix=hkfz delay=25.0')
  })

  it('parses the explicit skip semantics for register_count 0', () => {
    const reply = parseFleetRunReply(
      {
        ok: true,
        job_id: 'j0',
        running: false,
        dry_run: true,
        stages: [
          {
            name: 'register',
            status: 'ok',
            success: 0,
            failed: 0,
            total: 0,
            error: '',
            detail: 'register_count is 0, would skip registering'
          }
        ]
      },
      200
    )
    expect(reply.stages[0]?.total).toBe(0)
    expect(reply.stages[0]?.detail).toContain('would skip registering')
  })
})

describe('register channel view', () => {
  const block = (fields: Record<string, unknown>) =>
    parseFleetPlan({ ok: true, register: fields }, 200).register

  it('reads the verdict the gateway reports', () => {
    expect(block({ verdict: 'running' })?.verdict).toBe('running')
    expect(block({ verdict: 'stopped' })?.verdict).toBe('stopped')
    expect(block({ verdict: 'unknown' })?.verdict).toBe('unknown')
  })

  it('keeps an unrecognised verdict empty instead of guessing one', () => {
    expect(block({ verdict: 'weird' })?.verdict).toBe('')
    expect(block({})?.verdict).toBe('')
  })

  it('shows a running batch as progress, never as a failure', () => {
    const view = registerChannelView(
      block({ verdict: 'running', running: true, ok: true, reason: '', last_job: '20261128-224119-740211' })
    )
    expect(view.tone).toBe('progress')
    expect(view.text).toContain('20261128-224119-740211')
    expect(view.text).toContain('不是故障')
  })

  it('shows a stopped batch as progress rather than a channel fault', () => {
    const view = registerChannelView(block({ verdict: 'stopped', running: false, ok: false, reason: '' }))
    expect(view.tone).toBe('progress')
    expect(view.text).toContain('已被手动停止')
    expect(view.text).toContain('不是通道故障')
  })

  it('shows the upstream text verbatim when the batch failed', () => {
    const raw = 'hkx@loliko.top ERROR URLError(SSLEOFError(8, \'[SSL: UNEXPECTED_EOF_WHILE_READING]\'))'
    const view = registerChannelView(block({ verdict: 'failed', ok: false, reason: raw }))
    expect(view.tone).toBe('failure')
    expect(view.text).toBe(raw)
  })

  it('says the upstream gave no text when a failed batch carries an empty reason', () => {
    const view = registerChannelView(block({ verdict: 'failed', ok: false, reason: '' }))
    expect(view.tone).toBe('failure')
    expect(view.text).toBe('上游未给出失败文本')
  })

  it('names an undecidable batch without inventing an upstream error', () => {
    const view = registerChannelView(block({ verdict: 'unknown', ok: false, reason: '' }))
    expect(view.tone).toBe('failure')
    expect(view.text).toBe('网关无法判定最近一批的结论')
  })

  it('stays hidden for a healthy channel', () => {
    expect(registerChannelView(block({ verdict: 'ok', ok: true, reason: '' })).tone).toBe('hidden')
    expect(registerChannelView(null)).toEqual({ tone: 'hidden', text: '' })
  })

  it('falls back to the flags when the gateway sends no verdict at all', () => {
    expect(registerChannelView(block({ running: true })).tone).toBe('progress')
    expect(registerChannelView(block({ reason: 'boom' }))).toEqual({ tone: 'failure', text: 'boom' })
    expect(registerChannelView(block({})).tone).toBe('hidden')
  })

  it('never surfaces an internal machine token as an upstream reason', () => {
    const view = registerChannelView(block({ verdict: 'unknown', reason: 'register_channel_unknown' }))
    expect(view.text).not.toContain('register_channel_unknown')
  })
})

describe('tier source notice', () => {
  const planWith = (fields: Record<string, unknown>) =>
    parseFleetPlan({ ok: true, pro2_count: 12, ...fields }, 200)

  it('says the tier counts are merged, not measured today', () => {
    const notice = tierSourceNotice(
      planWith({ tier_sources: { cache: 47, pool: 45, none: 3 }, quota: { source: 'cache+pool', age_s: 1125242.1 } })
    )
    expect(notice).toContain('缓存 47 / 池文件 45')
    expect(notice).toContain('无档位 3')
    expect(notice).toContain('不是当天实测')
    expect(notice).toContain('13 天前')
  })

  it('warns when the sampling time is unknown', () => {
    const notice = tierSourceNotice(planWith({ tier_sources: { cache: 1, pool: 1, none: 0 }, quota: null }))
    expect(notice).toContain('采样时间未知')
  })

  it('stays hidden when the gateway sends no tier sources', () => {
    expect(tierSourceNotice(planWith({}))).toBeNull()
  })

  it('does not call a fresh reading stale', () => {
    const notice = tierSourceNotice(
      planWith({ tier_sources: { cache: 95, pool: 0, none: 0 }, quota: { source: 'cache', age_s: 30 } })
    )
    expect(notice).toContain('30 秒前')
    expect(notice).toContain('读数较新')
    expect(notice).not.toContain('不是当天实测')
  })

  it('calls an old reading stale', () => {
    const notice = tierSourceNotice(
      planWith({ tier_sources: { cache: 95, pool: 0, none: 0 }, quota: { source: 'cache', age_s: 86400 * 2 } })
    )
    expect(notice).toContain('2 天前')
    expect(notice).toContain('不是当天实测')
  })
})

describe('stage tier text', () => {
  const stage = (tiers: unknown) => ({
    name: 'register',
    stage: 'register',
    status: 'ok' as const,
    success: 2,
    failed: 0,
    total: 2,
    error: '',
    detail: '',
    tiers: tiers as never
  })

  it('prints the measured split when tiers are available', () => {
    const text = stageTierText(
      stage({ pro2: 1, pro1: 1, failed: 0, unknown: 0, available: true })
    )
    expect(text).toBe('实测档位: Pro2 1 / Pro1 1')
  })

  it('never reads as zero successes when tiers are unavailable', () => {
    const text = stageTierText(stage({ pro2: null, pro1: null, failed: null, unknown: null, available: false }))
    expect(text).toBe('档位数据未产生 (不能据此判断成功数量)')
    expect(text).not.toContain('0')
  })

  it('has nothing to say when the stage carries no tiers', () => {
    expect(stageTierText(stage(null))).toBeNull()
  })

  it('shows failures that the tier split counted', () => {
    const text = stageTierText(stage({ pro2: 0, pro1: 0, failed: 3, unknown: 0, available: true }))
    expect(text).toContain('失败 3')
  })

  it('shows a registered free tier account instead of hiding it', () => {
    const text = stageTierText(stage({ pro2: 0, pro1: 0, skip: 3, failed: 0, unknown: 0, available: true }))
    expect(text).toContain('免费档 3')
    expect(text).toContain('不能当满血号用')
  })

  it('says nothing about the free tier when its count is missing', () => {
    const text = stageTierText(stage({ pro2: 1, pro1: 0, failed: 0, unknown: 0, available: true }))
    expect(text).toBe('实测档位: Pro2 1 / Pro1 0')
    expect(text).not.toContain('免费档')
  })

  it('hides a free tier count of zero', () => {
    const text = stageTierText(stage({ pro2: 2, pro1: 0, skip: 0, failed: 0, unknown: 0, available: true }))
    expect(text).toBe('实测档位: Pro2 2 / Pro1 0')
    expect(text).not.toContain('免费档')
  })
})

describe('old remote mirror', () => {
  const diff = (remoteAccounts: number, remoteBots: number) => ({
    local_accounts: 2,
    remote_accounts: remoteAccounts,
    remote_bots: remoteBots,
    local_only: [],
    remote_only: [],
    name_diff: [],
    group_diff: [],
    same: 2,
    ok: true,
    remote_groups: [],
    local_groups: []
  })

  it('calls an answer without counters an old mirror', () => {
    expect(mirrorIsOld(null)).toBe(true)
  })

  it('accepts an answer that carries counters', () => {
    const counts = {
      groupsCreated: 1,
      groupsRenamed: 0,
      botsMatched: 2,
      botsUpdated: 2,
      botsCreated: 0,
      botsUnmatched: 0
    }
    expect(mirrorIsOld(counts)).toBe(false)
  })

  it('counts the accounts that never became bots', () => {
    expect(unmaterializedBots(diff(95, 91))).toBe(4)
  })

  it('reports no shortfall when every account has a bot', () => {
    expect(unmaterializedBots(diff(2, 2))).toBe(0)
  })

  it('never reports a negative shortfall', () => {
    expect(unmaterializedBots(diff(2, 5))).toBe(0)
  })
})

describe('inviter field hint', () => {
  const withProbe = (probe: unknown) => parseFleetPlan({ ok: true, probe }, 200)

  it('keeps the plain prompt before a plan is read', () => {
    expect(inviterFieldHint(null)).toBe('留空读网关盘点')
  })

  it('marks an expired snapshot as possibly overstating capacity', () => {
    const hint = inviterFieldHint(withProbe({ age_s: STALE_AFTER_S + 60, stale: true }))
    expect(hint).toContain('已过期')
    expect(hint).toContain('名额可能虚高')
  })

  it('calls a fresh snapshot live', () => {
    const hint = inviterFieldHint(withProbe({ age_s: 30, stale: false }))
    expect(hint).toContain('实时')
    expect(hint).not.toContain('虚高')
  })

  it('says a rescan is running', () => {
    const hint = inviterFieldHint(withProbe({ age_s: 30, stale: false, running: true }))
    expect(hint).toContain('后台正在重扫')
  })

  it('falls back to the prompt when the plan has no probe', () => {
    expect(inviterFieldHint(parseFleetPlan({ ok: true }, 200))).toBe('留空读网关盘点')
  })
})
