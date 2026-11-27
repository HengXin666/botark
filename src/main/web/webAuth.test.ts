import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import {
  WebAuth,
  clearSessionCookie,
  clientIp,
  hashPassword,
  isSameOriginRequest,
  parseCookies,
  parsePasswordHash,
  sessionCookie,
  verifyPasswordDigest
} from './webAuth'

const PASSWORD = 'correct horse battery staple'

function req(headers: Record<string, string> = {}, remoteAddress = '10.0.0.1'): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage
}

describe('web auth password hashing', () => {
  it('verifies the generated scrypt hash and rejects wrong passwords', () => {
    const encoded = hashPassword(PASSWORD)
    const digest = parsePasswordHash(encoded)
    expect(digest).not.toBeNull()
    expect(verifyPasswordDigest(PASSWORD, digest!)).toBe(true)
    expect(verifyPasswordDigest('wrong password', digest!)).toBe(false)
  })

  it('rejects malformed hashes', () => {
    expect(parsePasswordHash('scrypt$bad')).toBeNull()
    expect(parsePasswordHash('bcrypt$1$2$3$4$5')).toBeNull()
  })
})

describe('WebAuth password changes', () => {
  it('persists a new password and revokes existing sessions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'botark-web-auth-'))
    const file = join(dir, 'web-password.hash')
    try {
      const auth = new WebAuth({ password: PASSWORD, passwordStoreFile: file })
      const session = auth.issueSession()
      expect(auth.changePassword('wrong password', 'new password 456')).toBe(false)
      expect(auth.validateSession(session)).toBe(true)
      expect(auth.changePassword(PASSWORD, 'new password 456')).toBe(true)
      expect(auth.validateSession(session)).toBe(false)
      expect(auth.verifyPassword('new password 456')).toBe(true)

      const reopened = new WebAuth({ password: PASSWORD, passwordStoreFile: file })
      expect(reopened.verifyPassword('new password 456')).toBe(true)
      expect(reopened.verifyPassword(PASSWORD)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a too-short new password', () => {
    const auth = new WebAuth({ password: PASSWORD })
    expect(() => auth.changePassword(PASSWORD, 'short')).toThrow(/at least 8/)
  })
})

describe('WebAuth sessions and throttle', () => {
  it('requires a password with a minimum length', () => {
    expect(() => new WebAuth({})).toThrow(/required/)
    expect(() => new WebAuth({ password: 'short' })).toThrow(/at least 8/)
  })

  it('reads a password from a file for Docker secrets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'botark-web-auth-'))
    const file = join(dir, 'password')
    writeFileSync(file, 'file-password-12345\n', 'utf8')
    try {
      const auth = new WebAuth({ passwordFile: file })
      expect(auth.verifyPassword('file-password-12345')).toBe(true)
      expect(auth.verifyPassword('wrong-password')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('issues, validates and expires opaque sessions', async () => {
    const auth = new WebAuth({ password: PASSWORD, sessionTtlMs: 40 })
    const id = auth.issueSession()
    expect(id).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(auth.validateSession(id)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 70))
    expect(auth.validateSession(id)).toBe(false)
  })

  it('blocks repeated failures and clears them after success', () => {
    const auth = new WebAuth({
      password: PASSWORD,
      maxFailures: 2,
      failureWindowMs: 1_000,
      blockMs: 5_000
    })
    expect(auth.retryAfterMs('1.2.3.4')).toBe(0)
    auth.recordFailure('1.2.3.4')
    auth.recordFailure('1.2.3.4')
    expect(auth.retryAfterMs('1.2.3.4')).toBeGreaterThan(0)
    auth.clearFailures('1.2.3.4')
    expect(auth.retryAfterMs('1.2.3.4')).toBe(0)
  })
})

describe('web auth request helpers', () => {
  it('parses session cookies and builds hardened cookie headers', () => {
    expect(parseCookies('a=1; botark_session=abc; b=2').botark_session).toBe('abc')
    const cookie = sessionCookie('abc', 3600, true)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Secure')
    expect(clearSessionCookie(false)).toContain('Max-Age=0')
  })

  it('uses the first forwarded IP only when the proxy is trusted', () => {
    const request = req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }, '10.0.0.1')
    expect(clientIp(request, true)).toBe('1.1.1.1')
    expect(clientIp(request, false)).toBe('10.0.0.1')
  })

  it('checks same-origin login requests', () => {
    expect(isSameOriginRequest(req({ origin: 'https://botark.example.com', host: 'botark.example.com' }))).toBe(true)
    expect(isSameOriginRequest(req({ origin: 'https://evil.example.com', host: 'botark.example.com' }))).toBe(false)
    expect(isSameOriginRequest(req({}))).toBe(true)
  })
})
