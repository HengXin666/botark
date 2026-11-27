/**
 * Materialise Hark accounts that were imported on the server through the
 * remote sync API.  The server owns the cookie partitions; the browser
 * workspace only needs the account + bot entries so an admin can see and use
 * the account after opening the Web UI.
 */
import type { HarkRemoteImportRecord } from '@shared/ipc'
import { findHarkAccountId } from '@shared/harkPool'
import { getBridge } from '@/lib/bridge'
import { useBotStore } from '@/store/botStore'

function uniqueBotName(base: string, taken: string[]): string {
  const lower = new Set(taken.map((name) => name.toLowerCase()))
  if (!lower.has(base.toLowerCase())) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`
    if (!lower.has(candidate.toLowerCase())) return candidate
  }
}

export async function syncRemoteHarkAccounts(): Promise<{ added: number; existing: number }> {
  const hark = getBridge()?.hark
  if (!hark?.remoteList) return { added: 0, existing: 0 }
  const records = (await hark.remoteList()) as HarkRemoteImportRecord[]
  if (!Array.isArray(records) || records.length === 0) return { added: 0, existing: 0 }

  let added = 0
  let existing = 0
  for (const record of records) {
    if (!record || typeof record.accountId !== 'string' || !record.accountId) continue
    const state = useBotStore.getState()
    const knownAccountId = findHarkAccountId(state.accounts, record.email)
    const accountId = knownAccountId ?? record.accountId
    const alreadyBot = state.bots.some(
      (bot) => bot.platformId === 'hark' && bot.accountIds.includes(accountId)
    )
    if (alreadyBot) {
      existing += 1
      continue
    }
    const local = (record.email || record.displayName || 'Hark').split('@')[0] || 'Hark'
    state.addBot({
      id: `bot_${accountId}`,
      platformId: 'hark',
      name: uniqueBotName(`Hark ${local}`, state.bots.map((bot) => bot.name)),
      emoji: '✨',
      accounts: [
        {
          key: accountId,
          accountId,
          displayName: record.displayName || record.email,
          handle: record.email
        }
      ],
      group: { kind: 'new', name: 'Hark 远程同步' },
      background: true
    })
    added += 1
  }
  return { added, existing }
}
