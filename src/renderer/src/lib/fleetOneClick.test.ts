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
const COUNTS = {
  groupsCreated: 1,
  groupsRenamed: 0,
  botsMatched: 2,
  botsUpdated: 2,
  botsCreated: 0,
  botsUnmatched: 0
}
const MIRROR_OK = { accounts: 2, imported: 0, failed: 0, groups: 1, bots: 2, counts: COUNTS }
const MIRROR_OLD = { accounts: 2, imported: 2, failed: 0, groups: 1, bots: 2, counts: null }
const POOL_OK = { added: 2, moved: 0, kept: 0, placed_none: 0, existing: 0, refreshed: 2, failed: 0, skipped: 0 }
const DIFF_OK = {
  local_accounts: 2,
  remote_accounts: 2,
  remote_bots: 2,
  local_only: [],
  remote_only: [],
  name_diff: [],
  group_diff: [],
  same: 2,
  ok: true,
  remote_groups: ['Pro2'],
  local_groups: ['Pro2']
}
const DIFF_BAD = {
  ...DIFF_OK,
  ok: false,
  remote_only: ['a@b.com'],
  local_accounts: 2,
  remote_accounts: 3,
  remote_bots: 3
}

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
    importPool: async () => POOL_OK,
    syncToVps: async () => MIRROR_OK,
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
          return MIRROR_OLD
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

  it('names an old mirror instead of claiming a finished sync', async () => {
    const result = await runOneClick(
      INPUT,
      handlers({ states: [] }),
      ports({ syncToVps: async () => MIRROR_OLD })
    )
    expect(result.tone).toBe('failed')
    expect(result.step).toBe('verify')
    expect(result.line).toContain('VPS 镜像为旧版')
    expect(result.line).toContain('账号已导入')
    expect(result.line).toContain('git pull --ff-only')
    expect(result.line).not.toContain('已同步且双端一致')
    expect(result.line).not.toContain('同步完成')
  })

  it('keeps the success path when the metadata reply carries counters', async () => {
    const result = await runOneClick(INPUT, handlers({ states: [] }), ports())
    expect(result.tone).toBe('ok')
    expect(result.step).toBe('done')
    expect(result.line).toContain('已同步且双端一致')
  })

  it('counts the accounts an old mirror left without a bot', async () => {
    const lagging = { ...DIFF_OK, ok: false, remote_accounts: 95, remote_bots: 91, remote_only: [], same: 2 }
    const result = await runOneClick(
      INPUT,
      handlers({ states: [] }),
      ports({ syncToVps: async () => MIRROR_OLD, compare: async () => lagging })
    )
    expect(result.tone).toBe('failed')
    expect(result.line).toContain('4 个账号未物化为 bot')
    expect(result.line).toContain('属旧版镜像行为')
    expect(result.line).toContain('git pull --ff-only')
    expect(result.line).not.toContain('双端不一致')
  })

  it('imports the new accounts into the local workspace before syncing', async () => {
    const order: string[] = []
    const traces: string[] = []
    const result = await runOneClick(
      INPUT,
      { ...handlers({ states: [] }), onTrace: (line) => traces.push(line) },
      ports({
        importPool: async () => {
          order.push('import')
          return POOL_OK
        },
        syncToVps: async () => {
          order.push('sync')
          return MIRROR_OK
        },
        compare: async () => {
          order.push('compare')
          return DIFF_OK
        }
      })
    )
    expect(order).toEqual(['import', 'sync', 'compare'])
    expect(result.tone).toBe('ok')
    expect(result.step).toBe('done')
    const imported = traces.find((line) => line.includes('本地工作区导入')) ?? ''
    expect(imported).toContain('新增 2')
    expect(imported).toContain('重注入 2')
    expect(imported).toContain('迁移 0')
    expect(imported).toContain('保留 0')
  })

  it('keeps going after a failed local import but never claims a clean finish', async () => {
    const order: string[] = []
    const traces: string[] = []
    const result = await runOneClick(
      INPUT,
      { ...handlers({ states: [] }), onTrace: (line) => traces.push(line) },
      ports({
        importPool: async () => {
          order.push('import')
          throw new Error('网关 accounts/export 502')
        },
        syncToVps: async () => {
          order.push('sync')
          return MIRROR_OK
        },
        compare: async () => {
          order.push('compare')
          return DIFF_OK
        }
      })
    )
    expect(order).toEqual(['import', 'sync', 'compare'])
    expect(result.tone).toBe('failed')
    expect(result.line).toContain('新号未能导入本地工作区')
    expect(result.line).toContain('网关 accounts/export 502')
    expect(result.line).not.toContain('已同步且双端一致')
    expect(traces.some((line) => line.includes('本地工作区导入失败'))).toBe(true)
  })

  it('imports once even when the button is clicked twice', async () => {
    let imports = 0
    const slow = ports({
      importPool: async () => {
        imports += 1
        await new Promise((resolve) => setTimeout(resolve, 10))
        return POOL_OK
      }
    })
    const first = runOneClick(INPUT, handlers({ states: [] }), slow)
    const second = runOneClick(INPUT, handlers({ states: [] }), slow)
    const [a, b] = await Promise.all([first, second])
    expect(imports).toBe(1)
    expect(a).toBe(b)
  })

  it('skips the job but still writes both sides when the pool already meets the target', async () => {
    const done = parseFleetPlan(
      { ok: true, pro2_count: 17, target_pro2: 17, target_gap: 0, no_expansion: true },
      200
    )
    const calls = { start: 0, sync: 0, compare: 0, import: 0 }
    const traces: string[] = []
    const result = await runOneClick(
      INPUT,
      { ...handlers({ states: [] }), onTrace: (line) => traces.push(line) },
      ports({
        loadPlan: async () => done,
        startJob: async () => {
          calls.start += 1
          return { job_id: 'x', already_running: false, running: true }
        },
        importPool: async () => {
          calls.import += 1
          return POOL_OK
        },
        syncToVps: async () => {
          calls.sync += 1
          return MIRROR_OK
        },
        compare: async () => {
          calls.compare += 1
          return DIFF_OK
        }
      })
    )
    expect(calls).toEqual({ start: 0, sync: 1, compare: 1, import: 1 })
    expect(result.tone).toBe('ok')
    expect(result.step).toBe('done')
    expect(result.line).toContain('号池已达标')
    expect(result.line).toContain('本次未注册新号')
    expect(traces.some((line) => line.includes('target_gap=0'))).toBe(true)
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
