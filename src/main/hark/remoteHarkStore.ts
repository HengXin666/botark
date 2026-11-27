/**
 * Remote Hark account registry.
 *
 * A registration machine can push a fresh Hark session to a headless BotArk
 * instance over the REST API.  The session itself lives in Chromium's cookie
 * partition (written by importHarkCredentials); this file only remembers which
 * accounts were imported so the Web UI can materialise their bots after a
 * reload and repeat imports stay idempotent.
 */
import { app } from 'electron'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getAuthSession, extractHandle, importHarkCredentials } from './harkClient'

export interface RemoteHarkImportInput {
  accountId?: unknown
  email?: unknown
  sessionToken?: unknown
  displayName?: unknown
}

export interface RemoteHarkImportRecord {
  accountId: string
  email: string
  displayName: string
  importedAt: number
}

interface RemoteHarkFile {
  version: 1
  accounts: RemoteHarkImportRecord[]
}

const FILE_NAME = 'remote-hark-accounts.json'
const ACCOUNT_ID_RE = /^[A-Za-z0-9_-]{1,100}$/

function storePath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

function emptyFile(): RemoteHarkFile {
  return { version: 1, accounts: [] }
}

function readFile(): RemoteHarkFile {
  const path = storePath()
  if (!existsSync(path)) return emptyFile()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<RemoteHarkFile>
    return {
      version: 1,
      accounts: Array.isArray(parsed.accounts)
        ? parsed.accounts.filter((row): row is RemoteHarkImportRecord => {
            return Boolean(row) && typeof row === 'object' && typeof row.accountId === 'string' && typeof row.email === 'string'
          })
        : []
    }
  } catch {
    return emptyFile()
  }
}

function writeFile(doc: RemoteHarkFile): void {
  const path = storePath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, path)
  try {
    chmodSync(path, 0o600)
  } catch {
    /* best effort on filesystems without POSIX modes */
  }
}

function accountIdFor(email: string): string {
  const slug = email.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return 'acc_hark_' + (slug || 'account')
}

function emailOf(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/** List accounts imported through the remote sync API, newest last. */
export function listRemoteHarkImports(): RemoteHarkImportRecord[] {
  return readFile().accounts.slice().sort((a, b) => a.importedAt - b.importedAt)
}

/** Find an existing record by email; emails are the stable external identity. */
export function findRemoteHarkImport(email: string): RemoteHarkImportRecord | undefined {
  const needle = emailOf(email)
  return readFile().accounts.find((row) => row.email.toLowerCase() === needle)
}

/**
 * Validate a pushed Hark session, store its cookies in the account partition,
 * and remember the account.  Throws when the session cannot authenticate.
 */
export async function importRemoteHarkAccount(input: RemoteHarkImportInput): Promise<RemoteHarkImportRecord> {
  const email = emailOf(input.email)
  if (!email || !email.includes('@')) throw new Error('email 不是合法邮箱')
  const sessionToken = typeof input.sessionToken === 'string' ? input.sessionToken.trim() : ''
  if (!sessionToken) throw new Error('sessionToken 不能为空')

  const existing = findRemoteHarkImport(email)
  let accountId = typeof input.accountId === 'string' ? input.accountId.trim() : ''
  if (!ACCOUNT_ID_RE.test(accountId)) accountId = existing?.accountId || accountIdFor(email)
  if (existing) accountId = existing.accountId

  const imported = await importHarkCredentials(accountId, sessionToken)
  if (!imported) throw new Error('Hark 会话凭据无法解析')

  const session = await getAuthSession(accountId).catch(() => null)
  if (!session) throw new Error('Hark 会话无效或已过期')
  const identity = extractHandle(session)
  const sessionUser = session && typeof session === 'object' ? (session.user as Record<string, unknown> | undefined) : undefined
  const actualEmail = typeof sessionUser?.email === 'string' && sessionUser.email.trim() ? sessionUser.email.trim().toLowerCase() : email
  const displayName = (typeof input.displayName === 'string' ? input.displayName.trim() : '') || identity.displayName?.trim() || actualEmail

  const record: RemoteHarkImportRecord = {
    accountId,
    email: actualEmail,
    displayName,
    importedAt: Date.now()
  }
  const doc = readFile()
  const next = doc.accounts.filter((row) => row.accountId !== accountId && row.email.toLowerCase() !== record.email.toLowerCase())
  next.push(record)
  writeFile({ version: 1, accounts: next })
  return record
}
