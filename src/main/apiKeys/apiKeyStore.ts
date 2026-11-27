import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import type { ApiKeyAuditEntry, ApiKeyCreateResult, ApiKeyIdentity, ApiKeyView } from '@shared/apiKeys'
import { readJsonFile, writeJsonAtomic } from '../jsonFile'

export interface ApiKeyUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimated?: boolean
}

interface StoredApiKey {
  id: string
  name: string
  prefix: string
  hash: string
  createdAtMs: number
  lastUsedAtMs: number | null
  revokedAtMs: number | null
  requestCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedTokens: boolean
}

interface ApiKeyStoreFile {
  version: 1
  keys: StoredApiKey[]
  audit: ApiKeyAuditEntry[]
}

const STORE_VERSION = 1
const MAX_AUDIT_ENTRIES = 5000
const MAX_NAME_LENGTH = 64

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function emptyStore(): ApiKeyStoreFile {
  return { version: STORE_VERSION, keys: [], audit: [] }
}

function isStoreFile(raw: unknown): raw is ApiKeyStoreFile {
  const value = raw as Partial<ApiKeyStoreFile> | null
  return Boolean(
    value &&
      value.version === STORE_VERSION &&
      Array.isArray(value.keys) &&
      Array.isArray(value.audit)
  )
}

function toView(key: StoredApiKey): ApiKeyView {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    createdAtMs: key.createdAtMs,
    lastUsedAtMs: key.lastUsedAtMs,
    revokedAtMs: key.revokedAtMs,
    requestCount: key.requestCount,
    promptTokens: key.promptTokens,
    completionTokens: key.completionTokens,
    totalTokens: key.totalTokens,
    estimatedTokens: key.estimatedTokens
  }
}

export class ApiKeyStore {
  private readonly filePath: string
  private readonly revokeListeners = new Set<(keyId: string) => void>()
  private store: ApiKeyStoreFile
  private saveScheduled = false

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'api-keys.json')
    this.store = readJsonFile<ApiKeyStoreFile>(this.filePath, emptyStore(), isStoreFile)
  }

  private saveNow(): void {
    writeJsonAtomic(this.filePath, this.store, 0o600)
  }

  private scheduleSave(): void {
    if (this.saveScheduled) return
    this.saveScheduled = true
    setTimeout(() => {
      this.saveScheduled = false
      this.saveNow()
    }, 750).unref?.()
  }

  list(): ApiKeyView[] {
    return [...this.store.keys]
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .map(toView)
  }

  create(name: string): ApiKeyCreateResult {
    const cleanName = name.trim()
    if (!cleanName || cleanName.length > MAX_NAME_LENGTH) {
      throw new TypeError('密钥名称长度必须为 1-64 个字符')
    }
    if (this.store.keys.some((key) => key.name.toLowerCase() === cleanName.toLowerCase())) {
      throw new Error('已存在同名密钥，请换一个名称')
    }
    const token = 'bk_' + randomBytes(32).toString('base64url')
    const key: StoredApiKey = {
      id: randomUUID(),
      name: cleanName,
      prefix: token.slice(0, 12),
      hash: hashToken(token),
      createdAtMs: Date.now(),
      lastUsedAtMs: null,
      revokedAtMs: null,
      requestCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedTokens: false
    }
    this.store.keys.push(key)
    this.appendAudit({
      id: randomUUID(),
      keyId: key.id,
      keyName: key.name,
      atMs: Date.now(),
      method: 'ADMIN',
      path: 'api-key:create',
      statusCode: 200,
      durationMs: 0
    })
    this.saveNow()
    return { key: toView(key), token }
  }

  onRevoke(listener: (keyId: string) => void): () => void {
    this.revokeListeners.add(listener)
    return () => {
      this.revokeListeners.delete(listener)
    }
  }

  isActive(id: string): boolean {
    const key = this.store.keys.find((item) => item.id === id)
    return Boolean(key && key.revokedAtMs === null)
  }

  revoke(id: string): ApiKeyView {
    const key = this.store.keys.find((item) => item.id === id)
    if (!key) throw new Error('密钥不存在')
    if (key.revokedAtMs === null) {
      key.revokedAtMs = Date.now()
      this.appendAudit({
        id: randomUUID(),
        keyId: key.id,
        keyName: key.name,
        atMs: Date.now(),
        method: 'ADMIN',
        path: 'api-key:revoke',
        statusCode: 200,
        durationMs: 0
      })
      this.saveNow()
      for (const listener of this.revokeListeners) {
        try {
          listener(key.id)
        } catch {
          /* ignore subscriber errors */
        }
      }
    }
    return toView(key)
  }

  authenticate(token: string): ApiKeyIdentity | null {
    if (!token.startsWith('bk_')) return null
    const digest = Buffer.from(hashToken(token), 'hex')
    for (const key of this.store.keys) {
      if (key.revokedAtMs !== null) continue
      const expected = Buffer.from(key.hash, 'hex')
      if (expected.length !== digest.length || !timingSafeEqual(expected, digest)) continue
      key.lastUsedAtMs = Date.now()
      this.scheduleSave()
      return { id: key.id, name: key.name }
    }
    return null
  }

  recordRequest(entry: Omit<ApiKeyAuditEntry, 'id' | 'atMs' | 'keyName'> & { keyName?: string }): void {
    const key = this.store.keys.find((item) => item.id === entry.keyId)
    if (!key) return
    key.requestCount += 1
    this.appendAudit({
      id: randomUUID(),
      keyId: key.id,
      keyName: key.name,
      atMs: Date.now(),
      method: entry.method,
      path: entry.path,
      statusCode: entry.statusCode,
      durationMs: entry.durationMs,
      ...(entry.accountId ? { accountId: entry.accountId } : {}),
      ...(entry.botId ? { botId: entry.botId } : {}),
      ...(typeof entry.tokens === 'number' ? { tokens: entry.tokens } : {})
    })
    this.scheduleSave()
  }

  recordUsage(keyId: string, usage: ApiKeyUsage): void {
    const key = this.store.keys.find((item) => item.id === keyId)
    if (!key) return
    key.promptTokens += Math.max(0, Math.round(usage.promptTokens))
    key.completionTokens += Math.max(0, Math.round(usage.completionTokens))
    key.totalTokens += Math.max(0, Math.round(usage.totalTokens))
    if (usage.estimated) key.estimatedTokens = true
    this.scheduleSave()
  }

  audit(keyId: string, limit = 100): ApiKeyAuditEntry[] {
    const cap = Math.max(1, Math.min(500, Math.floor(limit)))
    return this.store.audit
      .filter((entry) => entry.keyId === keyId)
      .sort((a, b) => b.atMs - a.atMs)
      .slice(0, cap)
  }

  private appendAudit(entry: ApiKeyAuditEntry): void {
    this.store.audit.push(entry)
    if (this.store.audit.length > MAX_AUDIT_ENTRIES) {
      this.store.audit.splice(0, this.store.audit.length - MAX_AUDIT_ENTRIES)
    }
  }
}
