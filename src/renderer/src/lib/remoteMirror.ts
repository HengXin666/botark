/**
 * Push the local workspace shape (group names, bot names, assignments) to the
 * BotArk VPS, then refresh the local sidebar from the Hark gateway pool.
 */
import { getBridge } from '@/lib/bridge'
import { useBotStore } from '@/store/botStore'

const SETTINGS_KEY = 'botark-remote-mirror-v1'

export interface RemoteMirrorSettings {
  url: string
  token: string
}

function localRows(): Array<{ email: string; name: string; groupId: string }> {
  const state = useBotStore.getState()
  const rows: Array<{ email: string; name: string; groupId: string }> = []
  for (const bot of state.bots) {
    const first = bot.activeAccountId || bot.accountIds[0] || ''
    const account = state.accounts[first]
    if (!account || account.platformId !== 'hark') continue
    const email = (account.handle || account.displayName || '').trim().toLowerCase()
    if (!email) continue
    rows.push({ email, name: bot.name, groupId: bot.groupId })
  }
  return rows
}

export function loadMirrorSettings(): RemoteMirrorSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { url: '', token: '' }
    const parsed = JSON.parse(raw) as Partial<RemoteMirrorSettings>
    return {
      url: typeof parsed.url === 'string' ? parsed.url : '',
      token: typeof parsed.token === 'string' ? parsed.token : ''
    }
  } catch {
    return { url: '', token: '' }
  }
}

export function saveMirrorSettings(next: RemoteMirrorSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
}

/** Import missing sessions on the VPS and mirror group names, bot names and assignments. */
export async function mirrorWorkspaceToVps(
  onProgress?: (text: string) => void
): Promise<{ accounts: number; imported: number; failed: number; groups: number; bots: number }> {
  const bridge = getBridge()?.hark
  if (!bridge?.mirrorWorkspace) throw new Error('仅桌面版可用')
  const settings = loadMirrorSettings()
  if (!settings.url || !settings.token) throw new Error('先填写 VPS 地址与 API Key')
  const bots = localRows()
  if (bots.length === 0) throw new Error('本地没有 Hark bot 可同步')
  const groups = useBotStore.getState().groups.map((group) => ({ id: group.id, name: group.name }))
  onProgress?.(`正在同步 ${bots.length} 个 Hark bot 到 VPS...`)
  return bridge.mirrorWorkspace({ url: settings.url, token: settings.token, groups, bots })
}