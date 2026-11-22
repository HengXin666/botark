import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'bothub-proxy-assign-'))
const setProxy = vi.fn(async (_cfg: unknown) => undefined)

// Deterministic probe: host '10.0.0.1' is dead, every other endpoint is live.
const probe = vi.hoisted(() => vi.fn())
vi.mock('./proxyProbe', () => ({
  probeProxyNode: probe,
  buildAccountProxyUrl: (cfg: { mode: string; host?: string; port?: number }) =>
    cfg.mode === 'direct' || !cfg.host || !cfg.port ? null : `${cfg.mode}://${cfg.host}:${cfg.port}`
}))
vi.mock('electron', () => ({
  app: { getPath: () => dir },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (plain: string) => Buffer.from('enc:' + plain),
    decryptStringAsync: async (buf: Buffer) => ({ result: buf.toString().slice(4) })
  },
  session: { fromPartition: () => ({ setProxy }) }
}))
vi.mock('../webContentsViewManager', () => ({ partitionForAccount: (id: string) => `persist:test-${id}` }))

const { assignOneUnusedProxy } = await import('./accountProxy')

const enc = (cfg: object) => Buffer.from('enc:' + JSON.stringify(cfg)).toString('base64')
const poolPath = () => join(dir, 'muse-proxy-pool.json')
const accountPath = () => join(dir, 'muse-account-proxy.json')
const readPool = () => JSON.parse(readFileSync(poolPath(), 'utf8')) as Array<{ id: string; enc: string; assignedAccountId?: string }>
const readAccounts = () => JSON.parse(readFileSync(accountPath(), 'utf8')) as Record<string, { enc: string }>

beforeEach(() => {
  probe.mockReset()
  setProxy.mockClear()
  probe.mockImplementation(async (cfg: { host?: string }) => ({ ok: cfg.host !== '10.0.0.1' }))
  writeFileSync(poolPath(), JSON.stringify([]))
  writeFileSync(accountPath(), JSON.stringify({}))
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('assignOneUnusedProxy', () => {
  it('binds a free live node, drops dead ones and writes the pool assignment', async () => {
    writeFileSync(poolPath(), JSON.stringify([
      { id: 'dead', enc: enc({ mode: 'http', host: '10.0.0.1', port: 8080 }) },
      { id: 'live', enc: enc({ mode: 'http', host: '10.0.0.2', port: 8080 }) },
      { id: 'busy', enc: enc({ mode: 'socks5', host: '10.0.0.3', port: 1080 }), assignedAccountId: 'other' }
    ]))
    const result = await assignOneUnusedProxy('acc1')
    expect(result).toMatchObject({ assigned: true, removed: 1 })
    if (!result.assigned) throw new Error('expected a successful assignment')
    expect(result.view).toMatchObject({ mode: 'http', host: '10.0.0.2', port: 8080 })
    // dead removed, chosen bound to acc1, other account's slot untouched
    expect(readPool().map((s) => [s.id, s.assignedAccountId])).toEqual([
      ['live', 'acc1'],
      ['busy', 'other']
    ])
    expect(readAccounts()['acc1']).toBeDefined()
    expect(setProxy).toHaveBeenCalled()
  })

  it('releases the account\'s old slot when swapping to a working node', async () => {
    writeFileSync(poolPath(), JSON.stringify([
      { id: 'old', enc: enc({ mode: 'http', host: '10.0.0.9', port: 8080 }), assignedAccountId: 'acc1' },
      { id: 'fresh', enc: enc({ mode: 'http', host: '10.0.0.8', port: 8080 }) }
    ]))
    const result = await assignOneUnusedProxy('acc1')
    expect(result.assigned).toBe(true)
    expect(readPool().map((s) => [s.id, s.assignedAccountId])).toEqual([
      ['old', undefined],
      ['fresh', 'acc1']
    ])
  })

  it('does not touch the account config when no free live node exists', async () => {
    writeFileSync(poolPath(), JSON.stringify([
      { id: 'dead', enc: enc({ mode: 'http', host: '10.0.0.1', port: 8080 }) },
      { id: 'busy', enc: enc({ mode: 'http', host: '10.0.0.5', port: 8080 }), assignedAccountId: 'acc1' }
    ]))
    writeFileSync(accountPath(), JSON.stringify({ acc1: { enc: enc({ mode: 'http', host: '10.0.0.5', port: 8080 }) } }))
    const result = await assignOneUnusedProxy('acc1')
    expect(result).toMatchObject({ assigned: false, removed: 1, probed: 1 })
    // only the dead slot is removed; the account keeps its proxy and its slot
    expect(readPool().map((s) => [s.id, s.assignedAccountId])).toEqual([['busy', 'acc1']])
    expect(readAccounts()['acc1']).toBeDefined()
    expect(setProxy).not.toHaveBeenCalled()
  })

  it('reports no probe when the pool has no free slot at all', async () => {
    writeFileSync(poolPath(), JSON.stringify([
      { id: 'busy', enc: enc({ mode: 'http', host: '10.0.0.5', port: 8080 }), assignedAccountId: 'other' }
    ]))
    const result = await assignOneUnusedProxy('acc1')
    expect(result).toMatchObject({ assigned: false, probed: 0, removed: 0 })
    expect(probe).not.toHaveBeenCalled()
    expect(readPool().map((s) => s.id)).toEqual(['busy'])
  })
})
