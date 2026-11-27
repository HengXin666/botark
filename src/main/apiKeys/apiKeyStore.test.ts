import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiKeyStore } from './apiKeyStore'

const dirs: string[] = []

function makeStore(): { dir: string; store: ApiKeyStore } {
  const dir = mkdtempSync(join(tmpdir(), 'botark-api-keys-'))
  dirs.push(dir)
  return { dir, store: new ApiKeyStore(dir) }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('ApiKeyStore', () => {
  it('creates a permanent key, stores only its hash and authenticates it', () => {
    const { dir, store } = makeStore()
    const result = store.create('iPhone')
    expect(result.token).toMatch(/^bk_/)
    expect(result.key).toMatchObject({ name: 'iPhone', revokedAtMs: null, requestCount: 0, totalTokens: 0 })
    const raw = readFileSync(join(dir, 'api-keys.json'), 'utf8')
    expect(raw).not.toContain(result.token)
    expect(store.authenticate(result.token)).toMatchObject({ id: result.key.id, name: 'iPhone' })
    expect(store.authenticate('bk_wrong')).toBeNull()
  })

  it('records requests, usage and audit entries', () => {
    const { store } = makeStore()
    const result = store.create('script')
    store.recordRequest({
      keyId: result.key.id,
      method: 'POST',
      path: '/api/v1/accounts/a/projects/p/messages',
      statusCode: 200,
      durationMs: 12
    })
    store.recordUsage(result.key.id, { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimated: true })
    const view = store.list()[0]
    expect(view).toMatchObject({ requestCount: 1, promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedTokens: true })
    const audit = store.audit(result.key.id)
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'POST', path: '/api/v1/accounts/a/projects/p/messages', statusCode: 200 })
      ])
    )
  })

  it('revokes a key immediately and notifies subscribers', () => {
    const { store } = makeStore()
    const result = store.create('temporary')
    let revoked = ''
    const unsubscribe = store.onRevoke((id) => {
      revoked = id
    })
    expect(store.authenticate(result.token)).not.toBeNull()
    const view = store.revoke(result.key.id)
    expect(view.revokedAtMs).not.toBeNull()
    expect(store.authenticate(result.token)).toBeNull()
    expect(store.isActive(result.key.id)).toBe(false)
    expect(revoked).toBe(result.key.id)
    unsubscribe()
  })

  it('persists keys across store instances', () => {
    const { dir, store } = makeStore()
    const result = store.create('persisted')
    const reopened = new ApiKeyStore(dir)
    expect(reopened.list()[0]).toMatchObject({ id: result.key.id, name: 'persisted' })
    expect(reopened.authenticate(result.token)).not.toBeNull()
  })

  it('rejects duplicate active names', () => {
    const { store } = makeStore()
    store.create('same')
    expect(() => store.create('same')).toThrow('已存在同名密钥')
  })
})
