import { getBridge } from '@/lib/bridge'
import { useBotStore } from '@/store/botStore'
import { findHarkAccountId, harkPoolAccountId, harkPoolGroupName, harkTierForLimit, parseHarkPoolAccounts } from '@shared/harkPool'

const GATEWAY = 'http://localhost:8920'

export interface HarkPoolSyncResult {
  added: number
  moved: number
  existing: number
  failed: number
  skipped: number
}

function groupIdFor(name: string): string {
  const state = useBotStore.getState()
  const existing = state.groups.find((group) => group.name.toLowerCase() === name.toLowerCase())
  return existing?.id ?? state.addGroup(name)
}

function uniqueName(base: string, taken: string[]): string {
  const lower = new Set(taken.map((name) => name.toLowerCase()))
  if (!lower.has(base.toLowerCase())) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`
    if (!lower.has(candidate.toLowerCase())) return candidate
  }
}

function dailyLimitOf(summary: unknown): number | undefined {
  const tokens = (summary as { meters?: { harkTokens?: { dailyLimit?: unknown } } })?.meters?.harkTokens
  return typeof tokens?.dailyLimit === 'number' ? tokens.dailyLimit : undefined
}

async function liveDailyLimit(accountId: string): Promise<number | undefined> {
  const hark = getBridge()?.hark
  if (!hark?.rpc) return undefined
  const result = await hark.rpc({ accountId, op: 'call', method: 'GET', path: '/billing/summary' })
  return result.ok ? dailyLimitOf(result.data) : undefined
}

async function eachLimit<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const item = items[cursor++]
      if (item !== undefined) await run(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** Pull the local Hark pool, import new sessions and place every account into Pro2 or Pro1. */
export async function syncHarkPool(onProgress?: (text: string) => void): Promise<HarkPoolSyncResult> {
  const hark = getBridge()?.hark
  if (!hark?.importCredentials) throw new Error('仅桌面版可用')
  onProgress?.('正在读取 Hark 号池…')
  const [exportRes, quotaRes] = await Promise.all([
    fetch(GATEWAY + '/api/accounts/export?with_token=1'),
    fetch(GATEWAY + '/api/quota')
  ])
  if (!exportRes.ok || !quotaRes.ok) {
    throw new Error(`Hark 网关返回 ${exportRes.status} / ${quotaRes.status}`)
  }
  const parsed = parseHarkPoolAccounts(await exportRes.json(), await quotaRes.json())
  if (parsed.accounts.length === 0) throw new Error('号池为空或没有可导入的会话')

  const pro2 = groupIdFor('Pro2')
  const pro1 = groupIdFor('Pro1')
  const liveLimits = new Map<string, number>()
  const existingHark = Object.values(useBotStore.getState().accounts).filter(
    (item) => item.platformId === 'hark'
  )
  await eachLimit(existingHark, 6, async (item) => {
    const limit = await liveDailyLimit(item.id)
    if (limit !== undefined) liveLimits.set(item.id, limit)
  })
  let added = 0
  let moved = 0
  let existing = 0
  let failed = 0

  for (let index = 0; index < parsed.accounts.length; index += 1) {
    const account = parsed.accounts[index]!
    onProgress?.(`正在同步 ${index + 1}/${parsed.accounts.length}: ${account.email}`)
    const known = findHarkAccountId(useBotStore.getState().accounts, account.email)
    const liveLimit = known ? liveLimits.get(known) : undefined
    const tier = liveLimit !== undefined ? harkTierForLimit(liveLimit) : account.tier
    const groupId = harkPoolGroupName(tier) === 'Pro2' ? pro2 : pro1
    if (known) {
      const bot = useBotStore.getState().bots.find((item) => item.accountIds.includes(known))
      if (bot && tier !== 'unknown' && bot.groupId !== groupId) {
        useBotStore.getState().moveBotToGroup(bot.id, groupId)
        moved += 1
      } else {
        existing += 1
      }
      continue
    }

    const accountId = harkPoolAccountId(account.email)
    if (useBotStore.getState().accounts[accountId]) {
      existing += 1
      continue
    }
    const status = await hark.importCredentials({ accountId, rawInput: account.sessionToken })
    if (!status.signedIn) {
      failed += 1
      continue
    }
    const local = account.email.split('@')[0] || 'Hark'
    useBotStore.getState().addBot({
      id: `bot_${accountId}`,
      platformId: 'hark',
      name: uniqueName(`Hark · ${local}`, useBotStore.getState().bots.map((item) => item.name)),
      emoji: '✨',
      accounts: [{ key: accountId, accountId, displayName: account.email, handle: account.email }],
      group: { kind: 'existing', groupId },
      background: true
    })
    added += 1
  }

  return { added, moved, existing, failed, skipped: parsed.skipped }
}