import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'bothub-proxy-seed-'))

const sync = vi.hoisted(() => vi.fn())
vi.mock('./nodeMaint', () => ({
  syncNodeMaintLiveNodes: sync
}))
vi.mock('./proxyProbe', () => ({
  probeProxyNode: async () => ({ ok: true }),
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
  session: { fromPartition: () => ({ setProxy: async () => undefined }) }
}))
vi.mock('../webContentsViewManager', () => ({ partitionForAccount: (id: string) => `persist:test-${id}` }))

const { assignProxyPoolToAccounts, listProxyPool } = await import('./accountProxy')

beforeEach(() => {
  sync.mockReset()
  writeFileSync(join(dir, 'muse-proxy-pool.json'), JSON.stringify([]))
  writeFileSync(join(dir, 'muse-account-proxy.json'), JSON.stringify({}))
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('assignProxyPoolToAccounts', () => {
  it('imports http and https node-maint endpoints with their real scheme', async () => {
    sync.mockResolvedValue([
      { server: '203.0.113.10', port: 8080, score: 50, mode: 'http', egressIp: '198.51.100.1' },
      { server: '203.0.113.11', port: 443, score: 40, mode: 'https', egressIp: '198.51.100.2' }
    ])
    const result = await assignProxyPoolToAccounts(['acc1', 'acc2'])
    expect(result.assignedCount).toBe(2)
    const modes = (await listProxyPool()).map((item) => item.mode).sort()
    expect(modes).toEqual(['http', 'https'])
  })
})
