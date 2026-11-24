import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { MUSE_CHANNELS, type MuseEnsureRequest, type MuseRpcRequest, type WebViewBounds } from '@shared/ipc'
import { WebContentsViewManager } from '../webContentsViewManager'
import { MuseSessionManager } from './museSessionManager'
import {
  assignProxyPoolToAccounts,
  assignOneUnusedProxy,
  clearProxyPool,
  getProxyView,
  importProxyPool,
  importSubscription,
  syncNodeMaintPool,
  listProxyPool,
  reimportProxyConfigs,
  getProxyPoolItemSecret,
  removeProxyPoolItem,
  saveProxyConfig,
  type MuseProxyConfig,
  type MuseProxyMode
} from './accountProxy'
import { saveSyncedProtocolNodes, syncProtocolNodes } from './protocolNodes'
import { rebindGrokAccountWatch } from '../grok/grokWatchManager'
import { rebindDotAccountNetwork } from '../dot/dotClient'
import { cancelHarkWatch } from '../hark/harkClient'

const managers = new Map<number, MuseSessionManager>()

export function disposeAllMuseManagers(): void {
  for (const mgr of managers.values()) {
    mgr.destroyAll()
  }
  managers.clear()
}

function rebindNonMuseAccountStreams(accountId: string): void {
  rebindGrokAccountWatch(accountId)
  rebindDotAccountNetwork(accountId)
  cancelHarkWatch(accountId)
}

export function attachMuseSessionManager(window: BrowserWindow, views: WebContentsViewManager): MuseSessionManager {
  const manager = new MuseSessionManager(window, views)
  // Capture id before close: accessing window.webContents after 'closed' throws
  // TypeError: Object has been destroyed (seen on app quit).
  const senderId = window.webContents.id
  managers.set(senderId, manager)
  window.on('closed', () => managers.delete(senderId))

  // Forward muse events to the renderer that owns this window.
  manager.onEvent((event) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(MUSE_CHANNELS.event, event)
    }
  })
  return manager
}

function managerFor(event: IpcMainInvokeEvent): MuseSessionManager {
  const manager = managers.get(event.sender.id)
  if (!manager) throw new Error('Muse sessions are not available for this sender')
  return manager
}

function parseEnsure(value: unknown): MuseEnsureRequest {
  if (typeof value !== 'object' || value === null) throw new TypeError('Invalid muse ensure request')
  const v = value as Record<string, unknown>
  if (typeof v['botId'] !== 'string' || typeof v['accountId'] !== 'string') throw new TypeError('Invalid muse ensure request')
  return {
    botId: v['botId'],
    accountId: v['accountId'],
    show: v['show'] === true,
    bounds: v['bounds'] as WebViewBounds | undefined
  }
}

let registered = false

export function registerMuseIpc(): void {
  if (registered) return
  registered = true

  ipcMain.handle(MUSE_CHANNELS.ensure, async (event, request: unknown) => {
    const req = parseEnsure(request)
    return managerFor(event).ensure(req.botId, req.accountId, { show: req.show, bounds: req.bounds })
  })

  ipcMain.handle(MUSE_CHANNELS.rpc, async (event, request: unknown) => {
    if (typeof request !== 'object' || request === null) throw new TypeError('Invalid muse rpc request')
    const v = request as MuseRpcRequest
    if (typeof v.accountId !== 'string' || typeof v.method !== 'string') throw new TypeError('Invalid muse rpc request')
    return managerFor(event).rpc(v.accountId, v.method, v.params, v.conversationId)
  })

  ipcMain.handle(MUSE_CHANNELS.status, (event, accountId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Invalid accountId')
    return managerFor(event).getStatus(accountId) ?? null
  })

  ipcMain.handle(MUSE_CHANNELS.signOut, async (event, accountId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Invalid accountId')
    await managerFor(event).signOut(accountId)
  })

  ipcMain.handle(MUSE_CHANNELS.openLogin, async (event, request: unknown) => {
    const req = parseEnsure(request)
    return managerFor(event).openLogin(req.botId, req.accountId)
  })

  ipcMain.handle(MUSE_CHANNELS.autoLogin, async (event, request: unknown) => {
    const req = parseEnsure(request)
    const r = request as Record<string, unknown>
    if (typeof r['email'] !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(r['email'])) throw new TypeError('Invalid email')
    if (typeof r['inboxUrl'] !== 'string' || !/^https:\/\//.test(r['inboxUrl'])) throw new TypeError('Invalid inbox URL')
    return managerFor(event).autoLogin({ ...req, email: r['email'], inboxUrl: r['inboxUrl'] })
  })

  ipcMain.handle(MUSE_CHANNELS.showLogin, (event, accountId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Invalid accountId')
    return managerFor(event).showLogin(accountId)
  })

  ipcMain.handle(MUSE_CHANNELS.cancelLogin, async (event, accountId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Invalid accountId')
    await managerFor(event).cancelLogin(accountId)
  })

  ipcMain.handle(MUSE_CHANNELS.getQuota, async (event, accountId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Invalid accountId')
    return managerFor(event).getQuota(accountId)
  })

  ipcMain.handle(MUSE_CHANNELS.refreshQuota, async (event, accountId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Invalid accountId')
    return managerFor(event).refreshQuota(accountId)
  })

  ipcMain.handle(MUSE_CHANNELS.listSchedules, async (event, accountId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Invalid accountId')
    return managerFor(event).listSchedules(accountId)
  })

  ipcMain.handle(MUSE_CHANNELS.listScheduleRuns, async (event, accountId: unknown, jobId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Invalid accountId')
    if (jobId !== undefined && typeof jobId !== 'string') throw new TypeError('Invalid jobId')
    return managerFor(event).listScheduleRuns(accountId, typeof jobId === 'string' ? jobId : undefined)
  })

  ipcMain.handle(MUSE_CHANNELS.runSchedule, async (event, accountId: unknown, jobId: unknown) => {
    if (typeof accountId !== 'string' || typeof jobId !== 'string') throw new TypeError('Invalid schedule run request')
    return managerFor(event).runSchedule(accountId, jobId)
  })

  ipcMain.handle(MUSE_CHANNELS.deleteSchedule, async (event, accountId: unknown, jobId: unknown) => {
    if (typeof accountId !== 'string' || typeof jobId !== 'string') throw new TypeError('Invalid schedule delete request')
    return managerFor(event).deleteSchedule(accountId, jobId)
  })

  ipcMain.handle(MUSE_CHANNELS.getInvite, async (event, accountId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Invalid accountId')
    return managerFor(event).getInvite(accountId)
  })

  ipcMain.handle(MUSE_CHANNELS.refreshInvite, async (event, accountId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Invalid accountId')
    return managerFor(event).refreshInvite(accountId)
  })

  ipcMain.handle(MUSE_CHANNELS.redeemInvite, async (event, accountId: unknown, code: unknown) => {
    if (typeof accountId !== 'string' || typeof code !== 'string') throw new TypeError('Invalid invite redeem request')
    return managerFor(event).redeemInvite(accountId, code)
  })

  ipcMain.handle(MUSE_CHANNELS.listSessions, async (event, accountId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Invalid accountId')
    return managerFor(event).listSessions(accountId)
  })

  ipcMain.handle(MUSE_CHANNELS.mutateSession, async (event, accountId: unknown, mutation: unknown) => {
    if (typeof accountId !== 'string' || typeof mutation !== 'object' || mutation === null) {
      throw new TypeError('Invalid session mutation')
    }
    return managerFor(event).mutateSession(accountId, mutation as never)
  })

  ipcMain.handle(MUSE_CHANNELS.startSession, async (event, accountId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Invalid accountId')
    return managerFor(event).startSession(accountId)
  })

  ipcMain.handle(MUSE_CHANNELS.loadSessionHistory, async (event, accountId: unknown, sessionId: unknown) => {
    if (typeof accountId !== 'string' || typeof sessionId !== 'string') {
      throw new TypeError('Invalid loadSessionHistory request')
    }
    return managerFor(event).loadSessionHistory(accountId, sessionId)
  })

  ipcMain.handle(MUSE_CHANNELS.cancelChat, async (event, accountId: unknown, sessionId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Invalid accountId')
    return managerFor(event).cancelChat(accountId, typeof sessionId === 'string' ? sessionId : undefined)
  })

  ipcMain.handle(MUSE_CHANNELS.listFiles, async (event, accountId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Invalid accountId')
    return managerFor(event).listFiles(accountId)
  })

  ipcMain.handle(MUSE_CHANNELS.listConnectors, async (event, accountId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Invalid accountId')
    return managerFor(event).listConnectors(accountId)
  })

  ipcMain.handle(MUSE_CHANNELS.connectConnector, async (event, accountId: unknown, connectorId: unknown) => {
    if (typeof accountId !== 'string' || typeof connectorId !== 'string') {
      throw new TypeError('Invalid connector connect request')
    }
    return managerFor(event).connectConnector(accountId, connectorId)
  })

  ipcMain.handle(MUSE_CHANNELS.disconnectConnector, async (event, accountId: unknown, connectorId: unknown) => {
    if (typeof accountId !== 'string' || typeof connectorId !== 'string') {
      throw new TypeError('Invalid connector disconnect request')
    }
    return managerFor(event).disconnectConnector(accountId, connectorId)
  })


  ipcMain.handle(MUSE_CHANNELS.previewWorkspaceFile, async (event, accountId: unknown, path: unknown) => {
    if (typeof accountId !== 'string' || typeof path !== 'string') throw new TypeError('Invalid preview request')
    return managerFor(event).previewWorkspaceFile(accountId, path)
  })

  ipcMain.handle(MUSE_CHANNELS.uploadWorkspaceFile, async (event, accountId: unknown, args: unknown) => {
    if (typeof accountId !== 'string' || typeof args !== 'object' || args === null) {
      throw new TypeError('Invalid upload request')
    }
    const a = args as Record<string, unknown>
    if (typeof a['filename'] !== 'string' || typeof a['mimeType'] !== 'string' || typeof a['dataBase64'] !== 'string') {
      throw new TypeError('Invalid upload request fields')
    }
    return managerFor(event).uploadWorkspaceFile(accountId, {
      filename: a['filename'],
      mimeType: a['mimeType'],
      dataBase64: a['dataBase64']
    })
  })

  ipcMain.handle(MUSE_CHANNELS.getProxy, async (_event, accountId: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Invalid accountId')
    return getProxyView(accountId)
  })

  ipcMain.handle(MUSE_CHANNELS.setProxy, async (event, accountId: unknown, config: unknown) => {
    if (typeof accountId !== 'string') throw new TypeError('Invalid accountId')
    if (!config || typeof config !== 'object') throw new TypeError('Invalid proxy config')
    const c = config as MuseProxyConfig
    const view = await saveProxyConfig(accountId, c)
    await managerFor(event).applyAccountProxy(accountId)
    rebindNonMuseAccountStreams(accountId)
    return view
  })

  ipcMain.handle(MUSE_CHANNELS.listProxyPool, async () => {
    return listProxyPool()
  })

  ipcMain.handle(MUSE_CHANNELS.importProxyPool, async (_event, rawText: unknown, defaultMode: unknown) => {
    if (typeof rawText !== 'string') throw new TypeError('Invalid proxy pool text')
    const mode: Exclude<MuseProxyMode, 'direct'> =
      defaultMode === 'http' || defaultMode === 'socks5h' ? defaultMode : 'socks5'
    return importProxyPool(rawText, mode)
  })

  ipcMain.handle(MUSE_CHANNELS.subscribeProxyPool, async (_event, url: unknown, defaultMode: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new TypeError('Invalid subscription url')
    const mode: Exclude<MuseProxyMode, 'direct'> = defaultMode === 'http' || defaultMode === 'socks5' ? defaultMode : 'http'
    return importSubscription(url, mode)
  })

  ipcMain.handle(MUSE_CHANNELS.listSubscriptionSources, async () => {
    const { app } = await import('electron')
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const file = join(app.getPath('userData'), 'subscription-sources.json')
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'))
      return {
        subscriptions: Array.isArray(raw.subscriptions) ? raw.subscriptions : [],
        imported: raw.imported && typeof raw.imported === 'object' ? raw.imported : { total: 0, exported: 0, http: 0, socks5: 0, with_auth: 0 }
      }
    } catch {
      return { subscriptions: [], imported: { total: 0, exported: 0, http: 0, socks5: 0, with_auth: 0 } }
    }
  })

  ipcMain.handle(MUSE_CHANNELS.reimportProxyConfigs, async (_event, nodes: unknown, accountIds: unknown) => {
    if (!Array.isArray(nodes) || !Array.isArray(accountIds)) throw new TypeError('Invalid reimport payload')
    const clean = nodes.filter((n): n is { mode: string; host: string; port: number; username?: string; password?: string } => {
      if (!n || typeof n !== 'object') return false
      const x = n as Record<string, unknown>
      return (x.mode === 'http' || x.mode === 'socks5' || x.mode === 'socks5h') &&
        typeof x.host === 'string' && x.host.length > 0 && Number.isInteger(x.port) && (x.port as number) > 0 && (x.port as number) <= 65535
    })
    const ids = accountIds.filter((i): i is string => typeof i === 'string')
    return reimportProxyConfigs(clean as never, ids)
  })

  ipcMain.handle(MUSE_CHANNELS.syncNodeMaint, async (event) => {
    return syncNodeMaintPool((p) => {
      if (!event.sender.isDestroyed()) event.sender.send(MUSE_CHANNELS.event, { type: 'proxy-assign-progress', ...p })
    })
  })

  ipcMain.handle(MUSE_CHANNELS.syncProtocol, async (event, limit: unknown) => {
    const max = typeof limit === 'number' && limit > 0 ? Math.min(limit, 8000) : 4000
    const live = await syncProtocolNodes(max, (p) => {
      if (!event.sender.isDestroyed()) event.sender.send(MUSE_CHANNELS.event, { type: 'proxy-assign-progress', probed: p.done, live: p.alive, total: p.total, batch: 1, removed: 0, done: false })
    })
    if (live.length > 0) {
      await saveSyncedProtocolNodes(live)
      const lines = live.map((n) => 'socks5://127.0.0.1:' + n.localPort).join('\n')
      await importProxyPool(lines, 'socks5')
    }
    if (!event.sender.isDestroyed()) event.sender.send(MUSE_CHANNELS.event, { type: 'proxy-assign-progress', probed: live.length, live: live.length, total: live.length, batch: 1, removed: 0, done: true })
    return { live: live.length }
  })

  ipcMain.handle(MUSE_CHANNELS.getProxyPoolItemSecret, async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new TypeError('Invalid pool item id')
    return getProxyPoolItemSecret(id)
  })
  ipcMain.handle(MUSE_CHANNELS.removeProxyPoolItem, async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new TypeError('Invalid pool item id')
    return removeProxyPoolItem(id)
  })

  ipcMain.handle(MUSE_CHANNELS.clearProxyPool, async () => {
    return clearProxyPool()
  })

  ipcMain.handle(MUSE_CHANNELS.assignProxyPool, async (event, accountIds: unknown, keepIds?: unknown) => {
    if (!Array.isArray(accountIds)) throw new TypeError('Invalid accountIds array')
    const ids = accountIds.filter((id): id is string => typeof id === 'string')
    // Accounts that hold a slot but must not be handed a new one (Hark).
    const kept = new Set(Array.isArray(keepIds) ? keepIds.filter((id): id is string => typeof id === 'string') : [])
    const mgr = managerFor(event)
    return assignProxyPoolToAccounts(
      ids,
      async (accId) => {
        await mgr.applyAccountProxy(accId).catch(() => undefined)
        rebindNonMuseAccountStreams(accId)
      },
      // Logins still in flight are not in the renderer list yet; keep their proxy.
      (accId) => kept.has(accId) || [...managers.values()].some((m) => m.isLoginInFlight(accId)),
      (p) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(MUSE_CHANNELS.event, { type: 'proxy-assign-progress', ...p })
        }
      }
    )
  })

  ipcMain.handle(MUSE_CHANNELS.assignNextAvailableProxy, async (event, accountId: unknown) => {
    if (typeof accountId !== 'string' || !accountId) throw new TypeError('Invalid accountId')
    const result = await assignOneUnusedProxy(accountId)
    if (!result.assigned) return result
    await managerFor(event).applyAccountProxy(accountId).catch(() => undefined)
    rebindNonMuseAccountStreams(accountId)
    return result
  })

  ipcMain.handle(MUSE_CHANNELS.selectOption, async (event, request: unknown) => {
    if (typeof request !== 'object' || request === null) throw new TypeError('Invalid selectOption request')
    const v = request as Record<string, unknown>
    if (typeof v['accountId'] !== 'string' || typeof v['conversationId'] !== 'string') {
      throw new TypeError('Invalid selectOption request')
    }
    if (typeof v['hostMessageId'] !== 'string' || typeof v['selectedText'] !== 'string') {
      throw new TypeError('Invalid selectOption request')
    }
    if (typeof v['optionIndex'] !== 'number' || typeof v['widget'] !== 'object' || v['widget'] === null) {
      throw new TypeError('Invalid selectOption request')
    }
    return managerFor(event).selectOption(v['accountId'] as string, {
      conversationId: v['conversationId'] as string,
      hostMessageId: v['hostMessageId'] as string,
      selectedText: v['selectedText'] as string,
      optionIndex: v['optionIndex'] as number,
      widget: v['widget'] as never,
      sessionId: typeof v['sessionId'] === 'string' ? (v['sessionId'] as string) : undefined
    })
  })

  ipcMain.handle(MUSE_CHANNELS.openExternal, async (_event, url: unknown) => {
    if (typeof url !== 'string' || !/^https:\/\/(muse\.ai|www\.muse\.ai)(\/|$)/i.test(url)) {
      throw new TypeError('Only https://muse.ai URLs can be opened')
    }
    await shell.openExternal(url)
    return { ok: true as const }
  })

  ipcMain.handle(MUSE_CHANNELS.openHttps, async (_event, url: unknown) => {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
      throw new TypeError('Only https URLs can be opened')
    }
    await shell.openExternal(url)
    return { ok: true as const }
  })
}
