import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'bothub-proxy-'))
const setProxy = vi.fn(async (_cfg: unknown) => undefined)
let encryptionAvailable = true

vi.mock('electron', () => ({
  app: { getPath: () => dir },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => encryptionAvailable,
    decryptStringAsync: async () => {
      throw new Error('bad key')
    }
  },
  session: { fromPartition: () => ({ setProxy }) }
}))
vi.mock('../webContentsViewManager', () => ({ partitionForAccount: (id: string) => `persist:test-${id}` }))

const { applyAllStoredProxies, applyProxyToPartition, loadProxyConfig, ProxyConfigUnreadableError } = await import('./accountProxy')
const { parseSubscription, subscriptionNodesToLines } = await import('./subscription')

afterAll(() => rmSync(dir, { recursive: true, force: true }))
beforeEach(() => {
  setProxy.mockClear()
  encryptionAvailable = true
  writeFileSync(join(dir, 'muse-account-proxy.json'), JSON.stringify({ acc1: { enc: 'AAAA' } }))
})

describe('account proxy fails closed', () => {
  it('does not report direct when a stored proxy cannot be decrypted', async () => {
    await expect(loadProxyConfig('acc1')).rejects.toBeInstanceOf(ProxyConfigUnreadableError)
    encryptionAvailable = false
    await expect(loadProxyConfig('acc1')).rejects.toBeInstanceOf(ProxyConfigUnreadableError)
  })

  it('blocks the partition instead of going direct', async () => {
    await expect(applyProxyToPartition('acc1')).rejects.toBeInstanceOf(ProxyConfigUnreadableError)
    expect(setProxy).toHaveBeenCalledWith(expect.objectContaining({ proxyRules: 'http://127.0.0.1:9' }))
  })

  it('accounts without a proxy use system network stack', async () => {
    await expect(loadProxyConfig('nobody')).resolves.toEqual({ mode: 'direct' })
    await applyProxyToPartition('nobody')
    expect(setProxy).toHaveBeenCalledWith({ mode: 'system' })
  })

  it('applies every stored account at startup without throwing', async () => {
    const log = vi.fn()
    await applyAllStoredProxies(log)
    // Blocked before decrypting, and stays blocked when decryption fails.
    expect(setProxy.mock.calls.length).toBeGreaterThanOrEqual(1)
    for (const [cfg] of setProxy.mock.calls) expect(cfg).toMatchObject({ proxyRules: 'http://127.0.0.1:9' })
    expect(log).toHaveBeenCalledOnce()
  })
})

describe('subscription parsing', () => {
  it('collects http/socks5 lines and skips protocol nodes', () => {
    const text = [
      'vless://11111111-1111-1111-1111-111111111111@203.0.113.10:443#a',
      'http://userA:pwdA@203.0.113.12:3129',
      'socks5://userB:pwdB@203.0.113.13:1080',
      '203.0.113.14:8080'
    ].join('\n')
    const r = parseSubscription(text)
    expect(r.format).toBe('uri-list')
    expect(r.nodes.length).toBe(3)
    expect(subscriptionNodesToLines(r.nodes).split('\n').length).toBe(3)
    expect(r.skipped).toBe(1)
  })

  it('sniffs base64-wrapped uri lists by content', () => {
    const inner = 'ss://x@203.0.113.21:8388#s1\nhttp://u:p@203.0.113.22:3129'
    const r = parseSubscription(Buffer.from(inner).toString('base64'))
    expect(r.format).toBe('base64-uri')
    expect(r.nodes.length).toBe(1)
    expect(r.skipped).toBe(1)
  })

  it('reads http/socks5 entries from clash yaml', () => {
    const text = 'proxies:\n  - name: h1\n    type: http\n    server: 203.0.113.31\n    port: 3129\n    username: u1\n    password: p1\n  - name: s1\n    type: socks5\n    server: 203.0.113.32\n    port: 1080\n'
    const r = parseSubscription(text)
    expect(r.format).toBe('clash-yaml')
    expect(r.nodes.length).toBe(2)
    expect(subscriptionNodesToLines(r.nodes)).toContain('http://')
  })

  it('builds host-only proxyRules for a credentialed node', async () => {
    await applyProxyToPartition('acc1', {
      mode: 'http',
      host: '203.0.113.12',
      port: 3129,
      username: 'userA',
      password: 'pwdA'
    })
    expect(setProxy).toHaveBeenCalledWith(expect.objectContaining({
      proxyRules: 'http://203.0.113.12:3129',
      proxyBypassRules: '<local>'
    }))
  })
})
describe('proxy selection', () => {
  it('keeps public http/socks5 endpoints and drops loopback and duplicates', async () => {
    const { selectProxyNodes } = await import('./subscription')
    const report = await selectProxyNodes([
      { mode: 'http', host: '203.0.113.10', port: 3129 },
      { mode: 'socks5', host: '127.0.0.1', port: 1080 },
      { mode: 'http', host: '192.168.1.5', port: 8080 },
      { mode: 'http', host: '203.0.113.10', port: 3129 },
      { mode: 'socks5h', host: '203.0.113.11', port: 1080 } as never
    ])
    expect(report.candidates).toBe(5)
    expect(report.kept).toBe(1)
    expect(report.nodes[0]?.host).toBe('203.0.113.10')
    expect(report.rejected.some((r) => r.reason === 'non_public_ip')).toBe(true)
  })
})