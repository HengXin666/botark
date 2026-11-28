import { describe, expect, it } from 'vitest'
import {
  STALE_AFTER_S,
  defaultRegisterCount,
  diffWorkspace,
  firstFailedStage,
  fleetPlanQuery,
  localWorkspaceRows,
  parseFleetPlan,
  parseFleetRunReply,
  parseFleetStatus,
  probeIsStale,
  remoteWorkspaceRows,
  snapshotAge,
  stalledAtFirstStage,
  toMirrorPayload
} from './fleet'

const PLAN_REPLY = {
  ok: true,
  pool_accounts: 95,
  pro2_count: 7,
  pro1_count: 42,
  pro2: 7,
  pro1: 42,
  unknown: 46,
  unreachable: 0,
  available_inviters: [
    { email: 'A@One.com', friends_to_next_reward: 2, code: 'C1', rewards_earned: 0, source: 'probe' },
    { email: '', friends_to_next_reward: 1 }
  ],
  available_count: 1,
  fuel_needed: 14,
  target_pro2: 17,
  target_gap: 10,
  inviter_count: 12,
  inviter_gap: 7,
  show_rate: 0.25,
  candidate_inviters: 28,
  fuel_per_inviter: 3,
  register_count: 84,
  expected_pro2: 12,
  quota: { source: 'cache', sampled_at: 10.5, age_s: 12.3 },
  probe: { sampled_at: 10.5, age_s: 12.3, stale: false, running: false },
  register: { ok: false, stage: 'register', reason: 'turnstile gate', checked_at: 11.0, last_job: 'j1' }
}

describe('fleet plan parsing', () => {
  it('reads the full plan reply', () => {
    const plan = parseFleetPlan(PLAN_REPLY, 200)
    expect(plan.ok).toBe(true)
    expect(plan.pool_accounts).toBe(95)
    expect(plan.pro2_count).toBe(7)
    expect(plan.available_count).toBe(1)
    expect(plan.inviters).toEqual([
      {
        email: 'a@one.com',
        friends_to_next_reward: 2,
        code: 'C1',
        rewards_earned: 0,
        counted: null,
        source: 'probe'
      }
    ])
    expect(plan.fuel_count).toBeNull()
    expect(plan.register_count).toBe(84)
    expect(plan.quota?.age_s).toBe(12.3)
    expect(plan.probe?.stale).toBe(false)
    expect(plan.register?.reason).toBe('turnstile gate')
  })

  it('keeps missing numbers null instead of inventing them', () => {
    const plan = parseFleetPlan({ ok: true }, 200)
    expect(plan.ok).toBe(true)
    expect(plan.pool_accounts).toBeNull()
    expect(plan.pro2_count).toBeNull()
    expect(plan.register_count).toBeNull()
    expect(plan.available_count).toBeNull()
    expect(plan.inviters).toEqual([])
    expect(plan.quota).toBeNull()
    expect(plan.error).toBe('')
  })

  it('surfaces the upstream error body of an unready endpoint', () => {
    const plan = parseFleetPlan({ error: 'not found' }, 404)
    expect(plan.ok).toBe(false)
    expect(plan.error).toBe('not found')
    const text = parseFleetPlan('not found', 404)
    expect(text.ok).toBe(false)
    expect(text.error).toBe('HTTP 404')
  })

  it('builds the plan query without an empty inviter count', () => {
    expect(fleetPlanQuery({ target_pro2: 17, show_rate: 0.25 })).toBe(
      'target_pro2=17&show_rate=0.25'
    )
    expect(fleetPlanQuery({ target_pro2: 9, inviter_count: 4, refresh: true })).toBe(
      'target_pro2=9&inviter_count=4&refresh=1'
    )
  })
})

describe('fleet status parsing', () => {
  it('reads stages with their counts and status', () => {
    const status = parseFleetStatus(
      {
        ok: true,
        job_id: 'j1',
        running: false,
        dry_run: false,
        stage: 'upgrade',
        stages: [
          { name: 'register', status: 'ok', success: 20, failed: 0, total: 20, error: '' },
          { name: 'upgrade', status: 'failed', success: 3, failed: 2, total: 5, error: '429 raw' }
        ],
        summary: { pro2: 4 }
      },
      200
    )
    expect(status.job_id).toBe('j1')
    expect(status.stages).toHaveLength(2)
    expect(status.stages[1]).toEqual({
      name: 'upgrade',
      stage: 'upgrade',
      status: 'failed',
      success: 3,
      failed: 2,
      total: 5,
      error: '429 raw',
      detail: ''
    })
    expect(status.stages[0]?.error).toBe('')
  })

  it('falls back to pending for unknown stage statuses and drops nameless rows', () => {
    const status = parseFleetStatus({ ok: true, stages: [{ status: 'weird' }, { name: 'x' }] }, 200)
    expect(status.stages).toHaveLength(1)
    expect(status.stages[0]?.status).toBe('pending')
  })

  it('marks the 409 already-running reply', () => {
    const reply = parseFleetRunReply({ ok: false, error: 'already_running', job_id: 'j0' }, 409)
    expect(reply.already_running).toBe(true)
    expect(reply.ok).toBe(false)
    expect(reply.job_id).toBe('j0')
    expect(reply.error).toBe('already_running')
  })

  it('keeps the opening stage list of a run reply', () => {
    const reply = parseFleetRunReply(
      {
        ok: true,
        job_id: 'j2',
        running: true,
        dry_run: true,
        stages: [{ name: 'register', status: 'running', success: 0, failed: 0, total: 20, error: '' }]
      },
      200
    )
    expect(reply.ok).toBe(true)
    expect(reply.running).toBe(true)
    expect(reply.dry_run).toBe(true)
    expect(reply.stages[0]?.status).toBe('running')
  })
})

describe('workspace diff', () => {
  const local = localWorkspaceRows(
    [
      { name: 'A', groupId: 'g1', accountIds: ['a1'] },
      { name: 'B', groupId: 'g2', accountIds: ['a2'] },
      { name: 'G', groupId: 'g1', accountIds: ['a3'] }
    ],
    {
      a1: { handle: 'A@One.com', platformId: 'hark' },
      a2: { displayName: 'b@two.com', platformId: 'hark' },
      a3: { handle: 'g@three.com', platformId: 'grok' }
    },
    [
      { id: 'g1', name: 'Pro2' },
      { id: 'g2', name: 'Pro1' }
    ]
  )

  it('skips bots backed by another platform', () => {
    expect(local).toEqual([
      { email: 'a@one.com', name: 'A', groupId: 'g1', groupName: 'Pro2' },
      { email: 'b@two.com', name: 'B', groupId: 'g2', groupName: 'Pro1' }
    ])
  })

  it('reads remote rows from accounts, imports and bots', () => {
    const remote = remoteWorkspaceRows({
      groups: [{ id: 'rg1', name: 'Pro2' }],
      accounts: ['a@one.com'],
      imports: ['c@three.com'],
      bots: [{ handle: 'a@one.com', name: 'A2', groupId: 'rg1' }]
    })
    expect(remote).toEqual([
      { email: 'a@one.com', name: 'A2', groupName: 'Pro2' },
      { email: 'c@three.com', name: '', groupName: '' }
    ])
  })

  it('reports set, name and group differences', () => {
    const remote = remoteWorkspaceRows({
      groups: [{ id: 'rg2', name: 'Pro1' }],
      accounts: ['a@one.com', 'z@nine.com'],
      imports: [],
      bots: [{ handle: 'a@one.com', name: 'A renamed', groupId: 'rg2' }]
    })
    const diff = diffWorkspace(local, remote)
    expect(diff.local_accounts).toBe(2)
    expect(diff.remote_accounts).toBe(2)
    expect(diff.local_only).toEqual(['b@two.com'])
    expect(diff.remote_only).toEqual(['z@nine.com'])
    expect(diff.name_diff).toEqual([{ email: 'a@one.com', local: 'A', remote: 'A renamed' }])
    expect(diff.group_diff).toEqual([{ email: 'a@one.com', local: 'Pro2', remote: 'Pro1' }])
    expect(diff.ok).toBe(false)
  })

  it('treats identical sides as consistent', () => {
    const remote = remoteWorkspaceRows({
      groups: [
        { id: 'rg1', name: 'Pro2' },
        { id: 'rg2', name: 'Pro1' }
      ],
      accounts: ['a@one.com', 'b@two.com'],
      imports: [],
      bots: [
        { handle: 'a@one.com', name: 'A', groupId: 'rg1' },
        { handle: 'b@two.com', name: 'B', groupId: 'rg2' }
      ]
    })
    const diff = diffWorkspace(local, remote)
    expect(diff.ok).toBe(true)
    expect(diff.same).toBe(2)
  })

  it('only mirrors the groups that local rows use', () => {
    const payload = toMirrorPayload(local, [
      { id: 'g1', name: 'Pro2' },
      { id: 'g2', name: 'Pro1' },
      { id: 'g3', name: 'Unused' }
    ])
    expect(payload.groups.map((group) => group.id)).toEqual(['g1', 'g2'])
    expect(payload.bots).toHaveLength(2)
  })
})

describe('register count default', () => {
  it('multiplies the target by the fuel per inviter', () => {
    expect(defaultRegisterCount(17, 3)).toBe(51)
    expect(defaultRegisterCount(-2, 3)).toBe(0)
    expect(defaultRegisterCount(17, -3)).toBe(0)
  })
})

describe('freshness and failure display', () => {
  it('reads fuel_count and counted separately from fuel_needed', () => {
    const plan = parseFleetPlan(
      {
        ok: true,
        fuel_needed: 17,
        fuel_count: 35,
        available_inviters: [
          { email: 'a@one.com', friends_to_next_reward: 3, code: 'C', rewards_earned: 0, counted: 0 }
        ]
      },
      200
    )
    expect(plan.fuel_needed).toBe(17)
    expect(plan.fuel_count).toBe(35)
    expect(plan.inviters[0]?.counted).toBe(0)
  })

  it('keeps the dry run stage detail text', () => {
    const reply = parseFleetRunReply(
      {
        ok: true,
        job_id: 'j9',
        running: false,
        dry_run: true,
        stages: [
          {
            name: 'register',
            status: 'ok',
            success: 0,
            failed: 0,
            total: 20,
            error: '',
            detail: 'would register 20 accounts prefix=hkfz delay=25.0'
          }
        ]
      },
      200
    )
    expect(reply.stages[0]?.detail).toBe('would register 20 accounts prefix=hkfz delay=25.0')
    expect(reply.running).toBe(false)
    expect(reply.dry_run).toBe(true)
  })

  it('formats snapshot age in seconds, minutes, hours and days', () => {
    expect(snapshotAge(null)).toBe('采样时间未知')
    expect(snapshotAge(12)).toBe('12 秒前')
    expect(snapshotAge(384.7)).toBe('6 分钟前')
    expect(snapshotAge(7200)).toBe('2 小时前')
    expect(snapshotAge(172800)).toBe('2 天前')
  })

  it('treats a long-interval snapshot as stale even when the flag is false', () => {
    expect(probeIsStale(null)).toBe(true)
    expect(probeIsStale({ sampled_at: 1, age_s: 10, stale: false, running: false })).toBe(false)
    expect(probeIsStale({ sampled_at: 1, age_s: 10, stale: true, running: false })).toBe(true)
    expect(probeIsStale({ sampled_at: 1, age_s: STALE_AFTER_S + 1, stale: false, running: false })).toBe(true)
  })

  it('flags a job that stopped at its first stage', () => {
    const stalled = [
      { name: 'register', stage: 'register', status: 'failed' as const, success: 0, failed: 1, total: 2, error: 'turnstile', detail: '' },
      { name: 'upgrade', stage: 'upgrade', status: 'pending' as const, success: 0, failed: 0, total: 0, error: '', detail: '' }
    ]
    expect(firstFailedStage(stalled)).toBe(0)
    expect(stalledAtFirstStage(stalled)).toBe(true)
    const later = [
      { name: 'register', stage: 'register', status: 'ok' as const, success: 2, failed: 0, total: 2, error: '', detail: '' },
      { name: 'upgrade', stage: 'upgrade', status: 'failed' as const, success: 0, failed: 1, total: 1, error: 'boom', detail: '' }
    ]
    expect(firstFailedStage(later)).toBe(1)
    expect(stalledAtFirstStage(later)).toBe(false)
    expect(stalledAtFirstStage([])).toBe(false)
  })
})

describe('register verdict contract', () => {
  const liveBlock = {
    ok: false,
    running: false,
    verdict: 'stopped',
    stage: 'register',
    reason: '',
    job_id: '20261128-224119-740211',
    last_job: '20261128-224119-740211',
    exit: -15,
    count: 1,
    target: 1,
    checked_at: 1795876879.2,
    registered: 0,
    attempted: 0,
    future_field: 'ignored'
  }

  it('parses the real register block and ignores unknown keys', () => {
    const plan = parseFleetPlan({ ok: true, register: liveBlock }, 200)
    expect(plan.register?.verdict).toBe('stopped')
    expect(plan.register?.last_job).toBe('20261128-224119-740211')
    expect(plan.register?.ok).toBe(false)
    expect(plan.register?.reason).toBe('')
  })

  it('carries every verdict the gateway can send', () => {
    for (const verdict of ['ok', 'failed', 'running', 'stopped', 'unknown']) {
      const plan = parseFleetPlan({ ok: true, register: { ...liveBlock, verdict } }, 200)
      expect(plan.register?.verdict).toBe(verdict)
    }
  })

  it('does not accept an internal token as a verdict', () => {
    const plan = parseFleetPlan({ ok: true, register: { ...liveBlock, verdict: 'register_channel_unknown' } }, 200)
    expect(plan.register?.verdict).toBe('')
  })
})
