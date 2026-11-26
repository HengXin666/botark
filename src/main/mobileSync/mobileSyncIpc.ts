import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { app, BrowserWindow, dialog, ipcMain, session as electronSession } from 'electron'
import {
  MOBILE_SYNC_CHANNELS,
  type DirectHermesCredential,
  type MobileBridgeLiveEvent,
  type MobileHarkCredential,
  type MobileProxyNode,
  type MobileRelayCommand,
  type MobileSyncStateView,
  type MobileWorkspaceSnapshot
} from '@shared/mobileSync'
import { getHermesAccount, listHermesAccountRecords } from '../hermes/hermesStore'
import { partitionForAccount } from '../webContentsViewManager'
import { getProxyPoolItemSecret, listProxyPool } from '../muse/accountProxy'
import { ensureProxyRelays, relayAuth } from '../muse/mihomoManager'
import { listSyncedProtocolNodes } from '../muse/protocolNodes'
import { defaultMobileSyncDevicesPath, MobileSyncServer } from './mobileSyncServer'

let syncServer: MobileSyncServer | null = null
let registered = false

function broadcastState(state: MobileSyncStateView): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    win.webContents.send(MOBILE_SYNC_CHANNELS.stateChanged, state)
  }
}

function dispatchCommandToRenderer(command: MobileRelayCommand): void {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !w.webContents.isDestroyed())
  if (!win) return
  win.webContents.send(MOBILE_SYNC_CHANNELS.command, command)
}

function collectDirectHermesCredentials(): DirectHermesCredential[] {
  const out: DirectHermesCredential[] = []
  try {
    for (const rec of listHermesAccountRecords()) {
      const full = getHermesAccount(rec.accountId)
      if (!full?.baseUrl) continue
      out.push({
        accountId: full.accountId,
        baseUrl: full.baseUrl,
        apiKey: full.apiKey,
        model: full.model,
        displayName: full.displayName
      })
    }
  } catch {
    /* keychain locked or empty */
  }
  return out
}

async function collectHarkCredentials(
  snapshot: MobileWorkspaceSnapshot
): Promise<MobileHarkCredential[]> {
  const out: MobileHarkCredential[] = []
  for (const account of Object.values(snapshot.accounts)) {
    if (account.platformId !== 'hark') continue
    try {
      const ses = electronSession.fromPartition(partitionForAccount(account.id))
      const cookies = await ses.cookies.get({ url: 'https://app.hark.com' })
      const cookie = cookies
        .filter((item) => {
          // Keep only better-auth session cookies. Cloudflare/analytics cookies
          // are tied to the desktop IP and must not travel to the phone.
          if (!item.name || !item.value) return false
          if (/[\r\n;]/.test(item.name) || /[\r\n;]/.test(item.value)) return false
          if (item.name === '__Secure-hark.state' || item.name === '__Secure-hark.region_flow') return false
          return item.name.startsWith('__Secure-hark.') || /^better-auth\.session/i.test(item.name) ||
            (/hark.*session/i.test(item.name) && !/state|region/i.test(item.name))
        })
        .map((item) => `${item.name}=${item.value}`)
        .join('; ')
      if (!cookie) continue
      out.push({
        accountId: account.id,
        displayName: account.displayName,
        handle: account.handle,
        cookie,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      })
    } catch {
      /* one locked/expired account must not block the rest */
    }
  }
  return out
}

function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '0.0.0.0'
}

async function collectMobileProxyNodes(): Promise<MobileProxyNode[]> {
  const out: MobileProxyNode[] = []
  try {
    const uris = await listSyncedProtocolNodes(24)
    uris.forEach((uri, index) => {
      out.push({
        id: 'vless:' + createHash('sha1').update(uri).digest('hex').slice(0, 12),
        label: `协议节点 ${index + 1}`,
        mode: 'vless',
        uri
      })
    })
  } catch {
    /* no verified protocol nodes yet */
  }

  try {
    // The phone now runs its own Hark/agent clients, so it needs every proxy
    // the desktop knows about, including account-assigned ones. The previous
    // free-only filter could leave an all-assigned pool with zero phone nodes.
    const available = (await listProxyPool()).slice(0, 64)
    const direct: MobileProxyNode[] = []
    const relays: Array<{ item: (typeof available)[number]; secret: NonNullable<Awaited<ReturnType<typeof getProxyPoolItemSecret>>> }> = []
    for (const item of available) {
      const secret = await getProxyPoolItemSecret(item.id)
      if (!secret) continue
      // The phone protocol has no TLS-to-proxy mode yet; omit instead of mislabeling
      // an https endpoint as socks5/http (which would silently fail on the phone).
      if (secret.mode === 'https') continue
      if (isLoopbackHost(secret.host)) {
        relays.push({ item, secret })
      } else {
        direct.push({
          id: 'pool:' + item.id,
          label: `${secret.mode.toUpperCase()} ${secret.host}:${secret.port}`,
          mode: secret.mode === 'http' ? 'http' : 'socks5',
          host: secret.host,
          port: secret.port,
          username: secret.username,
          password: secret.password
        })
      }
    }
    out.push(...direct)

    if (relays.length > 0) {
      const ports = await ensureProxyRelays(
        relays.map(({ secret }) => ({
          mode: secret.mode === 'http' ? 'http' as const : 'socks5' as const,
          host: secret.host,
          port: secret.port,
          username: secret.username,
          password: secret.password
        }))
      )
      const auth = relayAuth()
      relays.forEach(({ item }, index) => {
        const port = ports[index] || 0
        if (!port) return
        out.push({
          id: 'relay:' + item.id,
          label: `本地代理 ${index + 1}`,
          mode: 'socks5',
          host: '',
          port,
          username: auth.username,
          password: auth.password
        })
      })
    }
  } catch {
    /* pool may be empty or encryption unavailable */
  }
  return out
}

function ensureServer(): MobileSyncServer {
  if (!syncServer) {
    syncServer = new MobileSyncServer({
      storePath: defaultMobileSyncDevicesPath(app.getPath('userData')),
      appVersion: app.getVersion(),
      getDirectCredentials: collectDirectHermesCredentials,
      getHarkCredentials: collectHarkCredentials,
      getProxyNodes: collectMobileProxyNodes,
      onCommand: dispatchCommandToRenderer,
      onStateChange: broadcastState
    })
  }
  return syncServer
}

export async function stopMobileSyncServer(): Promise<void> {
  if (syncServer) {
    await syncServer.stop().catch(() => undefined)
  }
}

export function registerMobileSyncIpc(): void {
  if (registered) return
  registered = true

  ipcMain.handle(MOBILE_SYNC_CHANNELS.getState, () => ensureServer().getState())
  ipcMain.handle(MOBILE_SYNC_CHANNELS.start, () => ensureServer().start())
  ipcMain.handle(MOBILE_SYNC_CHANNELS.stop, () => ensureServer().stop())
  ipcMain.handle(MOBILE_SYNC_CHANNELS.rotatePairing, () => ensureServer().rotatePairing())

  ipcMain.handle(MOBILE_SYNC_CHANNELS.setIncludeDirectCredentials, (_event, enabled: unknown) => {
    return ensureServer().setIncludeDirectCredentials(Boolean(enabled))
  })

  ipcMain.handle(MOBILE_SYNC_CHANNELS.revokeDevice, (_event, deviceId: unknown) => {
    if (typeof deviceId !== 'string') throw new TypeError('deviceId must be a string')
    return ensureServer().revokeDevice(deviceId)
  })

  ipcMain.handle(MOBILE_SYNC_CHANNELS.exportOfflineBundle, async (event) => {
    const srv = ensureServer()
    const proxyNodes = await collectMobileProxyNodes().catch(() => [])
    const { bundleJson, transferKey, fingerprint } = srv.createOfflineEncryptedBundle(proxyNodes)
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const defaultName = `BotArk-Sync-${fingerprint}.botark-sync`
    const result = win
      ? await dialog.showSaveDialog(win, {
          title: '导出加密同步包（可通过隔空投送发送到 iPhone）',
          defaultPath: defaultName,
          filters: [{ name: 'BotArk Sync Bundle', extensions: ['botark-sync', 'json'] }]
        })
      : await dialog.showSaveDialog({
          title: '导出加密同步包（可通过隔空投送发送到 iPhone）',
          defaultPath: defaultName,
          filters: [{ name: 'BotArk Sync Bundle', extensions: ['botark-sync', 'json'] }]
        })
    if (result.canceled || !result.filePath) {
      return { canceled: true as const }
    }
    writeFileSync(result.filePath, bundleJson, { encoding: 'utf8', mode: 0o600 })
    return {
      canceled: false as const,
      filePath: result.filePath,
      transferKey,
      fingerprint
    }
  })

  ipcMain.on(MOBILE_SYNC_CHANNELS.pushSnapshot, (_event, snapshot: unknown) => {
    if (!syncServer || !snapshot || typeof snapshot !== 'object') return
    syncServer.updateSnapshot(snapshot as MobileWorkspaceSnapshot)
  })

  ipcMain.on(MOBILE_SYNC_CHANNELS.pushEvent, (_event, payload: unknown) => {
    if (!syncServer || !payload || typeof payload !== 'object') return
    syncServer.broadcastLiveEvent(payload as MobileBridgeLiveEvent)
  })
}
