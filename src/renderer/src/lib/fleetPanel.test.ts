import { describe, expect, it } from 'vitest'
import {
  buildRunRequest,
  nextRegisterText,
  planHeadline,
  registerBlockNotice,
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

describe('register channel notice', () => {
  const block = (ok: boolean | null, reason: string) =>
    parseFleetPlan({ ok: true, register: { ok, reason, stage: 'register' } }, 200).register

  it('shows the failure text when the gateway reports the channel down', () => {
    const notice = registerBlockNotice(block(false, '22:26:09 RATE-LIMITED first hit, cool 300.0s'))
    expect(notice).toBe('22:26:09 RATE-LIMITED first hit, cool 300.0s')
  })

  it('shows the failure text even when a stale ok flag says the channel is fine', () => {
    const notice = registerBlockNotice(block(true, 'FAILED x@y.com turnstile gate'))
    expect(notice).toBe('FAILED x@y.com turnstile gate')
  })

  it('stays silent only when the channel is usable and carries no failure text', () => {
    expect(registerBlockNotice(block(true, ''))).toBeNull()
    expect(registerBlockNotice(null)).toBeNull()
  })

  it('still warns when the channel is down without any reason text', () => {
    expect(registerBlockNotice(block(false, ''))).toContain('未给出失败原因')
  })

  it('treats a missing ok flag with no reason as unusable rather than healthy', () => {
    expect(registerBlockNotice(block(null, ''))).toContain('未给出失败原因')
  })
})
