/**
 * Password authentication for the BotArk web gateway.
 *
 * The browser never receives the site password. It posts it once over the
 * reverse-proxied HTTPS connection; this module verifies a scrypt digest and
 * issues an opaque, HttpOnly session cookie. Sessions live in this process
 * only, so a restart logs every browser out.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { dirname } from 'node:path'

export const SESSION_COOKIE = 'botark_session'
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 64
const DEFAULT_SESSION_HOURS = 12
const DEFAULT_MAX_FAILURES = 5
const DEFAULT_FAILURE_WINDOW_MS = 15 * 60 * 1000
const DEFAULT_BLOCK_MS = 15 * 60 * 1000

export interface PasswordDigest {
  N: number
  r: number
  p: number
  salt: Buffer
  hash: Buffer
}

export interface WebAuthOptions {
  password?: string
  passwordFile?: string
  passwordHash?: string
  /** Optional persistent hash written when the admin changes the password in the UI. */
  passwordStoreFile?: string
  sessionTtlMs?: number
  trustProxy?: boolean
  maxFailures?: number
  failureWindowMs?: number
  blockMs?: number
}

interface SessionRecord {
  createdAt: number
  lastSeenAt: number
  expiresAt: number
}

interface AttemptRecord {
  failures: number
  firstFailureAt: number
  blockedUntil: number
}

function scrypt(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024
  })
}

export function hashPassword(password: string, salt: Buffer = randomBytes(16)): string {
  const digest = scrypt(password, salt)
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64url'),
    digest.toString('base64url')
  ].join('$')
}

export function parsePasswordHash(value: string): PasswordDigest | null {
  const parts = value.trim().split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) return null
  if (N < 2 || N > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 16) return null
  try {
    const salt = Buffer.from(parts[4], 'base64url')
    const hash = Buffer.from(parts[5], 'base64url')
    if (salt.length < 8 || hash.length !== KEY_LEN) return null
    return { N, r, p, salt, hash }
  } catch {
    return null
  }
}

export function verifyPasswordDigest(password: string, digest: PasswordDigest): boolean {
  try {
    const actual = scryptSync(password, digest.salt, digest.hash.length, {
      N: digest.N,
      r: digest.r,
      p: digest.p,
      maxmem: 64 * 1024 * 1024
    })
    return actual.length === digest.hash.length && timingSafeEqual(actual, digest.hash)
  } catch {
    return false
  }
}

function readStoredHash(file: string | undefined): string {
  if (!file || !existsSync(file)) return ''
  const value = readFileSync(file, 'utf8').trim()
  if (!value) return ''
  if (!parsePasswordHash(value)) {
    throw new Error('[web] password store is not a valid scrypt hash: ' + file)
  }
  return value
}

function digestFromPassword(password: string): PasswordDigest {
  const salt = randomBytes(16)
  return {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    salt,
    hash: scrypt(password, salt)
  }
}

export class WebAuth {
  private digest: PasswordDigest
  readonly sessionTtlMs: number
  readonly trustProxy: boolean
  private readonly passwordStoreFile?: string
  private readonly maxFailures: number
  private readonly failureWindowMs: number
  private readonly blockMs: number
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly attempts = new Map<string, AttemptRecord>()

  constructor(options: WebAuthOptions = {}) {
    this.passwordStoreFile = options.passwordStoreFile?.trim() || undefined
    const hashText = readStoredHash(this.passwordStoreFile) || options.passwordHash?.trim()
    const filePassword =
      !hashText && !options.password && options.passwordFile
        ? readFileSync(options.passwordFile, 'utf8').replace(/\r?\n$/, '')
        : ''
    const plainPassword = options.password && options.password.length > 0 ? options.password : filePassword

    if (hashText) {
      const parsed = parsePasswordHash(hashText)
      if (!parsed) {
        throw new Error('[web] BOTARK_WEB_PASSWORD_HASH is not a valid scrypt hash')
      }
      this.digest = parsed
    } else {
      if (!plainPassword) {
        throw new Error(
          '[web] BOTARK_WEB_PASSWORD (or BOTARK_WEB_PASSWORD_FILE / BOTARK_WEB_PASSWORD_HASH) is required in web mode'
        )
      }
      if (plainPassword.length < 8) {
        throw new Error('[web] Web password must be at least 8 characters')
      }
      this.digest = digestFromPassword(plainPassword)
    }

    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_HOURS * 60 * 60 * 1000
    this.trustProxy = options.trustProxy === true
    this.maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES
    this.failureWindowMs = options.failureWindowMs ?? DEFAULT_FAILURE_WINDOW_MS
    this.blockMs = options.blockMs ?? DEFAULT_BLOCK_MS
  }

  verifyPassword(password: string): boolean {
    return verifyPasswordDigest(password, this.digest)
  }

  /**
   * Change the admin password, persist the new hash when a store file is
   * configured, and invalidate every existing browser session.  Returns false
   * only when the supplied current password is wrong.
   */
  changePassword(currentPassword: string, newPassword: string): boolean {
    if (!this.verifyPassword(currentPassword)) return false
    if (newPassword.length < 8) {
      throw new Error('[web] New password must be at least 8 characters')
    }
    if (newPassword.length > 1024) {
      throw new Error('[web] New password is too long')
    }
    const encoded = hashPassword(newPassword)
    const parsed = parsePasswordHash(encoded)
    if (!parsed) throw new Error('[web] Failed to hash new password')
    if (this.passwordStoreFile) {
      mkdirSync(dirname(this.passwordStoreFile), { recursive: true })
      const temporary = this.passwordStoreFile + '.tmp-' + process.pid + '-' + Date.now()
      writeFileSync(temporary, encoded + '\n', { mode: 0o600 })
      renameSync(temporary, this.passwordStoreFile)
    }
    this.digest = parsed
    this.revokeAllSessions()
    return true
  }

  issueSession(): string {
    const now = Date.now()
    this.cleanup(now)
    while (this.sessions.size >= 100) {
      const oldest = this.sessions.keys().next().value
      if (!oldest) break
      this.sessions.delete(oldest)
    }
    const id = randomBytes(32).toString('base64url')
    this.sessions.set(id, {
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + this.sessionTtlMs
    })
    return id
  }

  validateSession(id: string): boolean {
    const record = this.sessions.get(id)
    if (!record) return false
    const now = Date.now()
    if (record.expiresAt <= now) {
      this.sessions.delete(id)
      return false
    }
    record.lastSeenAt = now
    return true
  }

  revokeSession(id: string): void {
    this.sessions.delete(id)
  }

  revokeAllSessions(): void {
    this.sessions.clear()
    this.attempts.clear()
  }

  retryAfterMs(ip: string): number {
    const record = this.attempts.get(ip)
    if (!record) return 0
    const now = Date.now()
    if (record.blockedUntil > now) return record.blockedUntil - now
    if (now - record.firstFailureAt > this.failureWindowMs) {
      this.attempts.delete(ip)
    }
    return 0
  }

  recordFailure(ip: string): void {
    const now = Date.now()
    let record = this.attempts.get(ip)
    if (!record || now - record.firstFailureAt > this.failureWindowMs) {
      record = { failures: 0, firstFailureAt: now, blockedUntil: 0 }
      this.attempts.set(ip, record)
    }
    record.failures += 1
    if (record.failures >= this.maxFailures) {
      record.blockedUntil = now + this.blockMs
    }
  }

  clearFailures(ip: string): void {
    this.attempts.delete(ip)
  }

  private cleanup(now: number): void {
    for (const [id, record] of this.sessions) {
      if (record.expiresAt <= now) this.sessions.delete(id)
    }
    for (const [ip, record] of this.attempts) {
      if (record.blockedUntil > 0 && record.blockedUntil <= now && now - record.firstFailureAt > this.failureWindowMs) {
        this.attempts.delete(ip)
      }
    }
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!header) return result
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key && !(key in result)) {
      try {
        result[key] = decodeURIComponent(value)
      } catch {
        result[key] = value
      }
    }
  }
  return result
}

export function sessionIdFromRequest(req: IncomingMessage): string | null {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] || null
}

export function sessionCookie(id: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    SESSION_COOKIE + '=' + encodeURIComponent(id),
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=' + String(Math.max(0, Math.floor(maxAgeSeconds)))
  ].concat(secure ? ['Secure'] : []).join('; ')
}

export function clearSessionCookie(secure: boolean): string {
  return [
    SESSION_COOKIE + '=',
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0'
  ].concat(secure ? ['Secure'] : []).join('; ')
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim()
    }
    const realIp = req.headers['x-real-ip']
    if (typeof realIp === 'string' && realIp.trim()) return realIp.trim()
  }
  return req.socket.remoteAddress || 'unknown'
}

export function isSecureRequest(
  req: IncomingMessage,
  forceSecure: boolean,
  trustProxy: boolean
): boolean {
  if (forceSecure) return true
  if ((req.socket as { encrypted?: boolean }).encrypted) return true
  if (!trustProxy) return false
  const proto = req.headers['x-forwarded-proto']
  if (typeof proto === 'string') return proto.split(',')[0].trim().toLowerCase() === 'https'
  return false
}

export function isSameOriginRequest(req: IncomingMessage, publicOrigin?: string): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const originUrl = new URL(origin)
    if (publicOrigin) return originUrl.origin === new URL(publicOrigin).origin
    const rawHost = req.headers['x-forwarded-host'] || req.headers.host
    const host = typeof rawHost === 'string' ? rawHost.split(',')[0].trim() : ''
    return Boolean(host) && originUrl.host === host
  } catch {
    return false
  }
}
