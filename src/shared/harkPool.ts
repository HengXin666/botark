export interface HarkAccountRef {
  id: string
  platformId: string
  handle?: string
}

export type HarkPoolTier = 'pro2' | 'pro' | 'unknown'

export interface HarkPoolAccount {
  email: string
  sessionToken: string
  limit?: number
  tier: HarkPoolTier
}

export interface HarkPoolParseResult {
  accounts: HarkPoolAccount[]
  skipped: number
}

function rowsOf(doc: unknown): Record<string, unknown>[] {
  const accounts = (doc as { accounts?: unknown })?.accounts
  if (!Array.isArray(accounts)) return []
  return accounts.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
}

/** Classify a Hark account by its measured daily token allowance. */
export function harkTierForLimit(limit: number | undefined): HarkPoolTier {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return 'unknown'
  if (limit >= 16_000_000) return 'pro2'
  if (limit >= 8_000_000) return 'pro'
  return 'unknown'
}

/** The two BotArk sections where imported Hark accounts live. */
export function harkPoolGroupName(tier: HarkPoolTier): 'Pro2' | 'Pro1' {
  return tier === 'pro2' ? 'Pro2' : 'Pro1'
}

/** Join the pool export with the live quota snapshot into import rows. */
export function parseHarkPoolAccounts(exportDoc: unknown, quotaDoc: unknown): HarkPoolParseResult {
  const limits = new Map<string, number>()
  for (const row of rowsOf(quotaDoc)) {
    const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : ''
    const limit = typeof row.limit === 'number' ? row.limit : undefined
    if (email && limit) limits.set(email, limit)
  }
  const accounts: HarkPoolAccount[] = []
  let skipped = 0
  for (const row of rowsOf(exportDoc)) {
    const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : ''
    const sessionToken = typeof row.session_token === 'string' ? row.session_token.trim() : ''
    if (!email || !sessionToken) {
      skipped += 1
      continue
    }
    const limit = limits.get(email)
    accounts.push({ email, sessionToken, limit, tier: harkTierForLimit(limit) })
  }
  return { accounts, skipped }
}

/** Stable account id so pressing the import button twice reuses partitions. */
export function harkPoolAccountId(email: string): string {
  const slug = email.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return 'acc_hark_' + (slug || 'account')
}

/** True when a Hark account already exists in the workspace. */
export function findHarkAccountId(accounts: Record<string, HarkAccountRef>, email: string): string | undefined {
  const needle = email.trim().toLowerCase()
  for (const account of Object.values(accounts)) {
    if (account.platformId !== 'hark') continue
    if ((account.handle || '').trim().toLowerCase() === needle) return account.id
  }
  return undefined
}
