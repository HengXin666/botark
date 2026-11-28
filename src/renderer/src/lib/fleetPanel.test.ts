import { describe, expect, it } from 'vitest'
import {
  buildRunRequest,
  nextRegisterText,
  planHeadline,
  registerChannelView,
  registerFieldValue
} from './fleetPanel'
import { parseFleetPlan, parseFleetRunReply } from '@shared/fleet'

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
