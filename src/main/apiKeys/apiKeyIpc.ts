import { app, ipcMain } from 'electron'
import { API_KEY_CHANNELS, type ApiKeyAuditEntry, type ApiKeyCreateResult, type ApiKeyView } from '@shared/apiKeys'
import { ApiKeyStore } from './apiKeyStore'

let store: ApiKeyStore | null = null
let registered = false

export function getApiKeyStore(): ApiKeyStore {
  if (!store) store = new ApiKeyStore(app.getPath('userData'))
  return store
}

export function registerApiKeyIpc(): void {
  if (registered) return
  registered = true
  const keyStore = getApiKeyStore()

  ipcMain.handle(API_KEY_CHANNELS.list, async (): Promise<ApiKeyView[]> => keyStore.list())
  ipcMain.handle(
    API_KEY_CHANNELS.create,
    async (_event, request: unknown): Promise<ApiKeyCreateResult> => {
      const name =
        typeof request === 'string'
          ? request
          : request && typeof request === 'object' && typeof (request as Record<string, unknown>)['name'] === 'string'
            ? String((request as Record<string, unknown>)['name'])
            : ''
      return keyStore.create(name)
    }
  )
  ipcMain.handle(API_KEY_CHANNELS.revoke, async (_event, id: unknown): Promise<ApiKeyView> => {
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('密钥 id 必须是非空字符串')
    return keyStore.revoke(id.trim())
  })
  ipcMain.handle(
    API_KEY_CHANNELS.audit,
    async (_event, id: unknown, limit: unknown): Promise<ApiKeyAuditEntry[]> => {
      if (typeof id !== 'string' || !id.trim()) throw new TypeError('密钥 id 必须是非空字符串')
      const n = typeof limit === 'number' && Number.isFinite(limit) ? limit : 100
      return keyStore.audit(id.trim(), n)
    }
  )
}
