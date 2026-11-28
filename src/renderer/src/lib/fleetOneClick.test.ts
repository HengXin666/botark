import { beforeEach, describe, expect, it } from 'vitest'
import {
  LIVE_PORTS,
  oneClickBusy,
  resetOneClick,
  runOneClick,
  type OneClickHandlers,
  type OneClickInput,
  type OneClickPorts,
  type OneClickState
} from './fleetOneClick'
import { parseFleetPlan, parseFleetStatus } from '@shared/fleet'

const OK_PLAN = parseFleetPlan(
  { ok: true, target_pro2: 17, register_count: 35, fuel_count: 35, register: { verdict: 'ok', ok: true } },
  200
)
const OK_STATUS = parseFleetStatus(
  {
    ok: true,
    running: false,
    job_id: 'job-1',
    stage: 'done',
    stages: [{ name: 'register', status: 'ok', success: 2, failed: 0, total: 2 }]
  },
  200
)
const FAILED_STATUS = parseFleetStatus(
  {
    ok: false,
    running: false,
    job_id: 'job-1',
    stage: 'register',
    stages: [
      { name: 'register', status: 'failed', success: 0, failed: 1, total: 2, error: 'RATE-LIMITED first hit' },
      { name: 'probe_inviters', status: 'pending' }
    ]
  },
  200
)
const DIFF_OK = {
  local_accounts: 2,
  remote_accounts: 2,
  local_only: [],
  remote_only: [],
  name_diff: [],
  group_diff: [],
  same: 2,
  ok: true,
  remote_groups: ['Pro2'],
  local_groups: ['Pro2']
}
const DIFF_BAD = { ...DIFF_OK, ok: false, remote_only: ['a@b.com'], local_accounts: 2, remote_accounts: 3 }

const INPUT: OneClickInput = {
  plan: { target_pro2: 17, show_rate: 0.25 },
  run: { target_pro2: 17, fuel_per_inviter: 3, prefix: 'hkfz', delay: 25, dry_run: false },
  pollMs: 1,
  jobTimeoutMs: 1000
}

function ports(overrides: Partial<OneClickPorts> = {}): OneClickPorts {
  return {
    loadPlan: async () => OK_PLAN,
    startJob: async () => ({ job_id: 'job-1', already_running: false, running: true }),
    pollStatus: async () => OK_STATUS,
    syncToVps: async () => ({ accounts: 2 }),
    compare: async () => DIFF_OK,
    sleep: async () => undefined,
    now: () => 0,
    ...overrides
  }
}

function handlers(collected: { states: OneClickState[] }): OneClickHandlers {
  return {
    onState: (next) => collected.states.push(next),
    onTrace: () => undefined,
    onPlan: () => undefined,
    onStatus: () => undefined,
    onDiff: () => undefined
  }
}

beforeEach(() => {
  resetOneClick()
})

describe('one-click expansion', () => {
  it('runs plan, expand, sync and verify to success', async () => {
    const collected = { states: [] as OneClickState[] }
    const result = await runOneClick(INPUT, handlers(collected), ports())
    expect(result.tone).toBe('ok')
    expect(result.step).toBe('done')
    expect(result.line).toContain('扩容已完成')
    expect(result.line).toContain('双端一致')
    const steps = collected.states.map((item) => item.step)
    expect(steps).toContain('plan')
    expect(steps).toContain('expand')
    expect(steps).toContain('sync')
    expect(steps).toContain('verify')
  })

  it('stops before any job when the plan fails', async () => {
    const badPlan = parseFleetPlan({ ok: false, error: 'plan 未就绪' }, 200)
    let started = 0
    const result = await runOneClick(
      INPUT,
      handlers({ states: [] }),
      ports({
        loadPlan: async () => badPlan,
        startJob: async () => {
          started += 1
          return { job_id: 'x', already_running: false, running: true }
        }
      })
    )
    expect(started).toBe(0)
    expect(result.tone).toBe('failed')
    expect(result.step).toBe('plan')
    expect(result.line).toContain('plan 未就绪')
  })

  it('stops before any job when the register channel is down', async () => {
    const blocked = parseFleetPlan(
      { ok: true, register: { verdict: 'failed', ok: false, reason: 'RATE-LIMITED first hit, cool 300.0s' } },
      200
    )
    let started = 0
    const result = await runOneClick(
      INPUT,
      handlers({ states: [] }),
      ports({
        loadPlan: async () => blocked,
        startJob: async () => {
          started += 1
          return { job_id: 'x', already_running: false, running: true }
        }
      })
    )
    expect(started).toBe(0)
    expect(result.tone).toBe('failed')
    expect(result.line).toContain('注册通道不可用')
    expect(result.line).toContain('RATE-LIMITED')
  })

  it('stops after a failed job and never syncs an incomplete pool', async () => {
    let synced = 0
    const result = await runOneClick(
      INPUT,
      handlers({ states: [] }),
      ports({
        pollStatus: async () => FAILED_STATUS,
        syncToVps: async () => {
          synced += 1
          return {}
        }
      })
    )
    expect(synced).toBe(0)
    expect(result.tone).toBe('failed')
    expect(result.step).toBe('expand')
    expect(result.line).toContain('register')
    expect(result.line).toContain('RATE-LIMITED first hit')
    expect(result.line).toContain('没有同步不完整的池')
  })

  it('reports a sync failure separately from an expansion failure', async () => {
    const result = await runOneClick(
      INPUT,
      handlers({ states: [] }),
      ports({
        syncToVps: async () => {
          throw new Error('VPS 401 token 过期')
        }
      })
    )
    expect(result.tone).toBe('failed')
    expect(result.step).toBe('sync')
    expect(result.line).toContain('扩容已完成但同步失败')
    expect(result.line).toContain('VPS 401 token 过期')
    expect(result.line).toContain('重试')
  })

  it('reports a diff mismatch after a successful sync', async () => {
    const result = await runOneClick(
      INPUT,
      handlers({ states: [] }),
      ports({ compare: async () => DIFF_BAD })
    )
    expect(result.tone).toBe('failed')
    expect(result.step).toBe('verify')
    expect(result.line).toContain('双端不一致')
    expect(result.line).toContain('远端独有 1')
  })

  it('joins the running job instead of starting a second one', async () => {
    let started = 0
    const result = await runOneClick(
      INPUT,
      handlers({ states: [] }),
      ports({
        startJob: async () => {
          started += 1
          return { job_id: 'job-1', already_running: true, running: true }
        }
      })
    )
    expect(started).toBe(1)
    expect(result.tone).toBe('ok')
  })

  it('refuses a second concurrent click and returns the first run', async () => {
    let started = 0
    const slow = ports({
      startJob: async () => {
        started += 1
        return { job_id: 'job-1', already_running: false, running: true }
      },
      sleep: async () => new Promise((resolve) => setTimeout(resolve, 5))
    })
    const first = runOneClick(INPUT, handlers({ states: [] }), slow)
    const second = runOneClick(INPUT, handlers({ states: [] }), slow)
    expect(oneClickBusy()).toBe(true)
    const [a, b] = await Promise.all([first, second])
    expect(started).toBe(1)
    expect(a).toBe(b)
    expect(oneClickBusy()).toBe(false)
  })

  it('can run again after the first run finished', async () => {
    const first = await runOneClick(INPUT, handlers({ states: [] }), ports())
    const second = await runOneClick(INPUT, handlers({ states: [] }), ports())
    expect(first.tone).toBe('ok')
    expect(second.tone).toBe('ok')
  })

  it('gives up waiting when the job never finishes', async () => {
    const running = parseFleetStatus({ ok: true, running: true, job_id: 'job-1', stage: 'register' }, 200)
    let clock = 0
    const result = await runOneClick(
      INPUT,
      handlers({ states: [] }),
      ports({
        pollStatus: async () => running,
        now: () => {
          clock += 400
          return clock
        }
      })
    )
    expect(result.tone).toBe('failed')
    expect(result.line).toContain('超时')
  })

  it('surfaces a thrown bridge error as a failed plan step', async () => {
    const result = await runOneClick(
      INPUT,
      handlers({ states: [] }),
      ports({
        loadPlan: async () => {
          throw new Error('网关 502')
        }
      })
    )
    expect(result.tone).toBe('failed')
    expect(result.line).toContain('网关 502')
  })
})

describe('live ports', () => {
  it('is wired to the bridge calls', () => {
    expect(typeof LIVE_PORTS.loadPlan).toBe('function')
    expect(typeof LIVE_PORTS.startJob).toBe('function')
    expect(typeof LIVE_PORTS.pollStatus).toBe('function')
    expect(typeof LIVE_PORTS.syncToVps).toBe('function')
    expect(typeof LIVE_PORTS.compare).toBe('function')
  })
})
