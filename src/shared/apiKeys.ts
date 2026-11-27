/** Admin-managed API keys for external clients (REST/SSE). */

export const API_KEY_CHANNELS = {
  list: 'bothub:api-keys:list',
  create: 'bothub:api-keys:create',
  revoke: 'bothub:api-keys:revoke',
  audit: 'bothub:api-keys:audit'
} as const

export interface ApiKeyIdentity {
  id: string
  name: string
}

export interface ApiKeyView {
  id: string
  name: string
  prefix: string
  createdAtMs: number
  lastUsedAtMs: number | null
  revokedAtMs: number | null
  requestCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** True while any token count is approximated (platform does not expose usage). */
  estimatedTokens: boolean
}

export interface ApiKeyCreateResult {
  key: ApiKeyView
  /** Returned exactly once; the server stores only its SHA-256 hash. */
  token: string
}

export interface ApiKeyAuditEntry {
  id: string
  keyId: string
  keyName: string
  atMs: number
  method: string
  path: string
  statusCode: number
  durationMs: number
  accountId?: string
  botId?: string
  tokens?: number
}

export interface ApiKeysBridge {
  list: () => Promise<ApiKeyView[]>
  create: (name: string) => Promise<ApiKeyCreateResult>
  revoke: (id: string) => Promise<ApiKeyView>
  audit: (id: string, limit?: number) => Promise<ApiKeyAuditEntry[]>
}
