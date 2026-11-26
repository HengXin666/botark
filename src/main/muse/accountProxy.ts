/**
 * Per-account BotHub client egress proxy (not a Muse RPC).
 * Persist via Electron safeStorage; apply to session partition + Noise WSS agent.
 */
import { join } from "node:path"
import { app, safeStorage, session as electronSession } from "electron"
import { partitionForAccount } from "../webContentsViewManager"
import { readJsonFile, writeJsonAtomic } from "../jsonFile"
import { createMutex, planPoolAssignment, planSinglePoolSwap, releasePoolSlot } from "@shared/proxyPool"
import type { AssignNextProxyResult } from "@shared/ipc"
import { syncNodeMaintLiveNodes, type NodeMaintLiveNode } from './nodeMaint'
import { buildAccountProxyUrl, probeProxyNode } from './proxyProbe'
export { buildAccountProxyUrl, probeProxyNode } from './proxyProbe'
import { parseProxyLine } from './proxySubscription'
export { importSubscription, parseProxyLine, type SubscriptionResult } from './proxySubscription'
import { registerProxyCredentials } from './proxyCredentials'
export { registerProxyCredentials, lookupProxyCredentials, createProxyAgent } from './proxyCredentials'

/** One lock for both proxy files: every change is read-modify-write across awaits. */
const withProxyStoreLock = createMutex()

export type MuseProxyMode = "direct" | "http" | "https" | "socks5" | "socks5h"

export interface MuseProxyConfig {
  mode: MuseProxyMode
  host?: string
  port?: number
  username?: string
  password?: string
}

interface StoredEntry {
  enc: string
}

type StoreFile = Record<string, StoredEntry>

function storePath(): string {
  return join(app.getPath("userData"), "muse-account-proxy.json")
}

function readStore(): StoreFile {
  return readJsonFile<StoreFile>(storePath(), {}, (raw) => Boolean(raw) && typeof raw === "object" && !Array.isArray(raw))
}

function writeStore(store: StoreFile): void {
  writeJsonAtomic(storePath(), store)
}

const PROXY_ENDPOINT_MODES = new Set<MuseProxyMode>(["http", "https", "socks5", "socks5h"])

function normalize(cfg: MuseProxyConfig | null | undefined): MuseProxyConfig {
  if (!cfg || cfg.mode === "direct") return { mode: "direct" }
  if (!PROXY_ENDPOINT_MODES.has(cfg.mode)) throw new Error("Unsupported proxy mode")
  const host = (cfg.host || "").trim()
  const port = Number(cfg.port)
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Proxy host and port (1–65535) are required")
  }
  return {
    mode: cfg.mode,
    host,
    port,
    username: cfg.username?.trim() || undefined,
    password: cfg.password || undefined
  }
}

/** Public view never returns the password; only whether one is stored. */
export type MuseProxyView = {
  mode: MuseProxyMode
  host?: string
  port?: number
  username?: string
  hasPassword: boolean
}

/** A proxy is configured but cannot be read (keychain/safeStorage). Never go direct silently. */
export class ProxyConfigUnreadableError extends Error {
  constructor(detail?: string) {
    super(`代理配置无法读取（系统钥匙串/加密不可用${detail ? `：${detail}` : ""}），已阻止直连；请重新保存该账号的代理`)
    this.name = "ProxyConfigUnreadableError"
  }
}

/** Unreachable proxy used to block a partition whose real proxy cannot be read. */
const BLOCKING_PROXY_RULE = "http://127.0.0.1:9"

/**
 * Hark polling calls loadProxyConfig/applyProxyToPartition on every request.
 * Without a cache that is a synchronous JSON read plus a keychain decrypt per
 * request; with 80 accounts it is the main-process bottleneck. The cache is
 * invalidated by this module's own save/clear paths.
 */
const proxyConfigCache = new Map<string, MuseProxyConfig>()

function cacheProxyConfig(accountId: string, cfg: MuseProxyConfig): MuseProxyConfig {
  const copy = { ...cfg }
  proxyConfigCache.set(accountId, copy)
  return { ...copy }
}

export async function loadProxyConfig(accountId: string): Promise<MuseProxyConfig> {
  const cached = proxyConfigCache.get(accountId)
  if (cached) return { ...cached }
  const entry = readStore()[accountId]
  if (!entry?.enc) return cacheProxyConfig(accountId, { mode: "direct" })
  let available = false
  try {
    available = await safeStorage.isAsyncEncryptionAvailable()
  } catch {
    available = false
  }
  if (!available) throw new ProxyConfigUnreadableError()
  try {
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(entry.enc, "base64"))
    return cacheProxyConfig(accountId, normalize(JSON.parse(decrypted.result) as MuseProxyConfig))
  } catch (err) {
    throw new ProxyConfigUnreadableError(err instanceof Error ? err.message : undefined)
  }
}

export async function getProxyView(accountId: string): Promise<MuseProxyView> {
  const cfg = await loadProxyConfig(accountId)
  if (cfg.mode === "direct") return { mode: "direct", hasPassword: false }
  return {
    mode: cfg.mode,
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    hasPassword: Boolean(cfg.password)
  }
}

export async function saveProxyConfig(accountId: string, input: MuseProxyConfig): Promise<MuseProxyView> {
  return withProxyStoreLock(() => saveProxyConfigUnlocked(accountId, input))
}

async function saveProxyConfigUnlocked(accountId: string, input: MuseProxyConfig): Promise<MuseProxyView> {
  const next = normalize(input)
  const store = readStore()
  if (next.mode === "direct") {
    delete store[accountId]
    writeStore(store)
    proxyConfigCache.set(accountId, { mode: "direct" })
    await applyProxyToPartition(accountId, next)
    return { mode: "direct", hasPassword: false }
  }
  // Keep previous password when UI sends empty password + has existing.
  if (!next.password) {
    const prev = await loadProxyConfig(accountId).catch(() => null)
    if (prev?.password) next.password = prev.password
  }
  const available = await safeStorage.isAsyncEncryptionAvailable()
  if (!available) {
    throw new Error("safeStorage encryption unavailable; refusing to store proxy credentials in plaintext")
  }
  const enc = await safeStorage.encryptStringAsync(JSON.stringify(next))
  store[accountId] = { enc: enc.toString("base64") }
  writeStore(store)
  proxyConfigCache.set(accountId, { ...next })
  await applyProxyToPartition(accountId, next)
  return {
    mode: next.mode,
    host: next.host,
    port: next.port,
    username: next.username,
    hasPassword: Boolean(next.password)
  }
}

export async function clearProxyConfig(accountId: string): Promise<void> {
  await withProxyStoreLock(() => {
    const store = readStore()
    delete store[accountId]
    writeStore(store)
  })
  proxyConfigCache.set(accountId, { mode: "direct" })
  await applyProxyToPartition(accountId, { mode: "direct" })
}


/**
 * Resolve the per-account proxy URL string (`http://...`, `socks5://...`, `socks5h://...`)
 * for Node-side `proxyFetch` / `proxyWsAgent` callers (Grok, Dot, etc.).
 * Throws `ProxyConfigUnreadableError` if a proxy is configured on disk yet
 * `safeStorage` cannot decrypt it — never silently falls back to direct.
 */
export async function loadAccountProxyUrl(accountId: string): Promise<string | undefined> {
  const cfg = await loadProxyConfig(accountId)
  return buildAccountProxyUrl(cfg) ?? undefined
}

export async function applyProxyToPartition(accountId: string, cfg?: MuseProxyConfig): Promise<void> {
  const ses = electronSession.fromPartition(partitionForAccount(accountId))
  let c: MuseProxyConfig
  try {
    c = cfg ?? (await loadProxyConfig(accountId))
  } catch (err) {
    // Fail closed: an unreadable proxy must not turn into the real IP.
    await ses.setProxy({ proxyRules: BLOCKING_PROXY_RULE, proxyBypassRules: "" })
    throw err
  }
  if (c.mode === "direct") {
    await ses.setProxy({ mode: "system" })
    return
  }
  if (!c.host || !c.port) {
    await ses.setProxy({ proxyRules: BLOCKING_PROXY_RULE, proxyBypassRules: "" })
    return
  }
  registerProxyCredentials(c.host, c.port, c.username, c.password)
  const mode = c.mode === "socks5h" ? "socks5" : c.mode
  const hostOnly = `${mode}://${c.host}:${c.port}`
  await ses.setProxy({ proxyRules: hostOnly, proxyBypassRules: "<local>" })
}

export interface MuseProxyPoolItemView {
  id: string
  mode: Exclude<MuseProxyMode, "direct">
  host: string
  port: number
  username?: string
  hasPassword: boolean
  assignedAccountId?: string
}

interface StoredPoolItem {
  id: string
  enc: string
  assignedAccountId?: string
}

function poolStorePath(): string {
  return join(app.getPath("userData"), "muse-proxy-pool.json")
}

function readPoolStore(): StoredPoolItem[] {
  return readJsonFile<StoredPoolItem[]>(poolStorePath(), [], Array.isArray)
}

function writePoolStore(list: StoredPoolItem[]): void {
  writeJsonAtomic(poolStorePath(), list)
}

/** Parse one proxy line (`socks5://u:p@h:p`, `http://h:p`, `h:p:u:p`, `h:p`). */
async function decryptPoolItem(item: StoredPoolItem): Promise<MuseProxyConfig | null> {
  try {
    const available = await safeStorage.isAsyncEncryptionAvailable()
    if (!available) return null
    const dec = await safeStorage.decryptStringAsync(Buffer.from(item.enc, "base64"))
    return normalize(JSON.parse(dec.result) as MuseProxyConfig)
  } catch {
    return null
  }
}

export async function listProxyPool(): Promise<MuseProxyPoolItemView[]> {
  const list = readPoolStore()
  const out: MuseProxyPoolItemView[] = []
  for (const item of list) {
    const cfg = await decryptPoolItem(item)
    if (!cfg || cfg.mode === "direct" || !cfg.host || !cfg.port) continue
    out.push({
      id: item.id,
      mode: cfg.mode,
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      hasPassword: Boolean(cfg.password),
      assignedAccountId: item.assignedAccountId
    })
  }
  return out
}

export async function importProxyPool(
  rawText: string,
  defaultMode: Exclude<MuseProxyMode, "direct"> = "socks5"
): Promise<{ added: number; total: number; items: MuseProxyPoolItemView[] }> {
  const available = await safeStorage.isAsyncEncryptionAvailable()
  if (!available) {
    throw new Error("safeStorage encryption unavailable")
  }
  const added = await withProxyStoreLock(() => importIntoPoolUnlocked(rawText, defaultMode))
  const items = await listProxyPool()
  return { added, total: items.length, items }
}

async function importIntoPoolUnlocked(
  rawText: string,
  defaultMode: Exclude<MuseProxyMode, "direct">
): Promise<number> {
  const existing = readPoolStore()
  const existingConfigs = await Promise.all(existing.map(decryptPoolItem))
  const seenKeys = new Set(
    existingConfigs
      .filter((c): c is MuseProxyConfig => Boolean(c && c.host && c.port))
      .map((c) => `${c.mode}://${c.username || ""}@${c.host}:${c.port}`)
  )

  let added = 0
  for (const line of rawText.split(/\r?\n/)) {
    const parsed = parseProxyLine(line, defaultMode)
    if (!parsed || parsed.mode === "direct" || !parsed.host || !parsed.port) continue
    const key = `${parsed.mode}://${parsed.username || ""}@${parsed.host}:${parsed.port}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    const enc = await safeStorage.encryptStringAsync(JSON.stringify(parsed))
    existing.push({
      id: `px_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      enc: enc.toString("base64")
    })
    added += 1
  }
  writePoolStore(existing)
  return added
}

export async function removeProxyPoolItem(id: string): Promise<MuseProxyPoolItemView[]> {
  await withProxyStoreLock(() => writePoolStore(readPoolStore().filter((x) => x.id !== id)))
  return listProxyPool()
}

export async function clearProxyPool(): Promise<MuseProxyPoolItemView[]> {
  await withProxyStoreLock(() => writePoolStore([]))
  return []
}

/**
 * Match 1 proxy from the pool to each accountId in `accountIds` (1-to-1).
 * Accounts that already have a pool proxy keep it; unassigned accounts get the
 * next free pool proxy (or round-robin if pool is smaller than accounts).
 */
export interface ProxyAssignProgress {
  probed: number
  live: number
  total: number
  batch: number
  removed: number
  done: boolean
}

let assignInFlight: Promise<{ assignedCount: number; items: MuseProxyPoolItemView[] }> | null = null

export async function assignProxyPoolToAccounts(
  accountIds: string[],
  onAssigned?: (accountId: string) => Promise<void>,
  keep?: (accountId: string) => boolean,
  onProgress?: (p: ProxyAssignProgress) => void
): Promise<{ assignedCount: number; items: MuseProxyPoolItemView[] }> {
  if (assignInFlight) return assignInFlight
  assignInFlight = runAssign(accountIds, onAssigned, keep, onProgress).finally(() => { assignInFlight = null })
  return assignInFlight
}

let syncInFlight: Promise<{ live: number }> | null = null

/** Public: pull live nodes from node-maint, merge into pool and report stats. */
export async function syncNodeMaintPool(onProgress?: (p: ProxyAssignProgress) => void): Promise<{ live: number }> {
  // App bootstrap and the settings card can both fire on launch; one pull is enough.
  if (syncInFlight) return syncInFlight
  syncInFlight = seedPoolFromNodeMaint(onProgress)
    .then((live) => ({ live }))
    .finally(() => { syncInFlight = null })
  return syncInFlight
}

/** One node-maint pull serves both the explicit sync and the assignment that follows it. */
let lastSeedAt = 0
let lastSeed: NodeMaintLiveNode[] = []
const SEED_CACHE_MS = 30_000

async function seedPoolFromNodeMaint(onProgress?: (p: ProxyAssignProgress) => void): Promise<number> {
  const fresh = Date.now() - lastSeedAt < SEED_CACHE_MS
  const live = fresh ? lastSeed : await syncNodeMaintLiveNodes()
  if (!fresh) {
    lastSeed = live
    lastSeedAt = Date.now()
  }
  if (live.length === 0) return 0
  // Preserve the endpoint scheme: an https node is a TLS proxy listener and must
  // not be downgraded to http:// (`MuseProxyMode` has a dedicated https mode).
  const lines = live.map((n) => `${n.mode}://${n.server}:${n.port}`).join('\n')
  await importProxyPool(lines, 'http')
  onProgress?.({ probed: live.length, live: live.length, total: live.length, batch: 1, removed: 0, done: true })
  return live.length
}

async function runAssign(
  accountIds: string[],
  onAssigned?: (accountId: string) => Promise<void>,
  keep?: (accountId: string) => boolean,
  onProgress?: (p: ProxyAssignProgress) => void
): Promise<{ assignedCount: number; items: MuseProxyPoolItemView[] }> {
  const seeded = await seedPoolFromNodeMaint(onProgress)
  const configured = await withProxyStoreLock(async () => {
    const pool = readPoolStore()
    if (pool.length === 0 || accountIds.length === 0) return [] as string[]
    void seeded
    const candidates: Array<{ slot: typeof pool[number]; cfg: NonNullable<Awaited<ReturnType<typeof decryptPoolItem>>> }> = []
    for (const slot of pool) {
      const cfg = await decryptPoolItem(slot)
      if (cfg && cfg.mode !== "direct" && cfg.host && cfg.port) candidates.push({ slot, cfg })
    }
    const total = candidates.length
    const liveSlots: typeof pool = []
    const deadIds = new Set<string>()
    // Public proxy nodes routinely need 2.5-3.5s for CONNECT + TLS; an 800ms
    // probe used to mark every working node dead and wipe the whole pool.
    const deadline = Date.now() + 15_000
    const batchSize = 32
    const probeBudget = Math.min(candidates.length, Math.max(accountIds.length, 64))
    let probed = 0
    let batch = 0
    let removedCount = 0
    for (let i = 0; i < candidates.length; i += batchSize) {
      if (Date.now() >= deadline || probed >= probeBudget || liveSlots.length >= accountIds.length) break
      batch += 1
      const slice = candidates.slice(i, i + batchSize)
      const results = await Promise.all(slice.map(async ({ slot, cfg }) => {
        const probe = await probeProxyNode(cfg, 4_000)
        return { slot, ok: probe.ok }
      }))
      probed += slice.length
      for (const r of results) {
        if (r.ok) liveSlots.push(r.slot)
        else { deadIds.add(r.slot.id); removedCount += 1 }
      }
      onProgress?.({ probed, live: liveSlots.length, total, batch, removed: removedCount, done: false })
    }
    if (deadIds.size > 0) {
      writePoolStore(pool.filter((s) => !deadIds.has(s.id)))
    }
    onProgress?.({ probed, live: liveSlots.length, total, batch, removed: removedCount, done: true })
    if (liveSlots.length === 0) return [] as string[]
    const plan = planPoolAssignment(liveSlots, accountIds, keep)
    const done: string[] = []
    for (const { accountId, slot } of plan.assigned) {
      const cfg = await decryptPoolItem(slot)
      if (cfg && cfg.mode !== "direct") {
        await saveProxyConfigUnlocked(accountId, cfg)
        done.push(accountId)
      }
    }
    const liveIds = new Set(liveSlots.map((s) => s.id))
    const remaining = pool.filter((s) => !deadIds.has(s.id))
    const finalPool = remaining.map((s) => {
      const assigned = plan.pool.find((p) => p.id === s.id)?.assignedAccountId
      return liveIds.has(s.id) ? { ...s, assignedAccountId: assigned } : s
    })
    writePoolStore(finalPool)
    return done
  })
  for (const accountId of configured) await onAssigned?.(accountId)
  return { assignedCount: configured.length, items: await listProxyPool() }
}

/** Give an account's pool proxy back (failed/cancelled login) and drop its config. */
export async function releaseProxyPoolAccount(accountId: string): Promise<void> {
  const held = await withProxyStoreLock(() => {
    const pool = readPoolStore()
    if (!pool.some((p) => p.assignedAccountId === accountId)) return false
    writePoolStore(releasePoolSlot(pool, accountId))
    return true
  })
  if (held) await clearProxyConfig(accountId)
}

/**
 * Apply every stored account proxy before any window or request runs.
 * Partitions start direct after a restart; Hark (no connect step) used to
 * stay direct until the proxy was saved again.
 */
export async function applyAllStoredProxies(log: (msg: string, err: unknown) => void = console.warn): Promise<void> {
  let ids: string[]
  try {
    ids = Object.keys(readStore())
  } catch (err) {
    log("[proxy] proxy store unreadable at startup", err)
    return
  }
  // Fail closed first (no decryption needed), so a slow keychain prompt
  // never lets the first requests out with the real IP.
  await Promise.all(
    ids.map((id) =>
      electronSession
        .fromPartition(partitionForAccount(id))
        .setProxy({ proxyRules: BLOCKING_PROXY_RULE, proxyBypassRules: "" })
        .catch((err: unknown) => log(`[proxy] ${id} not blocked`, err))
    )
  )
  await Promise.all(
    ids.map((id) => applyProxyToPartition(id).catch((err) => log(`[proxy] ${id} not applied`, err)))
  )
}

/**
 * Bind ONE free, probed-live pool node to `accountId` and make it effective.
 *
 * Unlike the bulk `assignProxyPoolToAccounts` (which re-seeds node-maint and
 * recomputes every account), this is scoped to a single account: it probes only
 * the UNUSED slots, drops the ones that fail, releases the account's previous
 * slot, and saves the chosen config through the same path as `setProxy` so the
 * partition and live Noise/WSS agent switch immediately. Returns `assigned: false`
 * (with probe/removal counts) when the pool has no free working node, so the UI
 * can offer a recovery action instead of silently falling back to a direct connection.
 */
export async function assignOneUnusedProxy(accountId: string): Promise<AssignNextProxyResult> {
  return withProxyStoreLock(async () => {
    const pool = readPoolStore()
    // Only genuinely free slots are candidates; the slot currently held by
    // this account is released (not re-picked) so a broken proxy is swapped.
    const freeSlots = pool.filter((s) => !s.assignedAccountId)
    const budget = Math.min(freeSlots.length, 64)
    const liveIds = new Set<string>()
    const deadIds = new Set<string>()
    let probed = 0
    const batchSize = 32
    for (let i = 0; i < budget; i += batchSize) {
      const slice = freeSlots.slice(i, Math.min(i + batchSize, budget))
      const results = await Promise.all(slice.map(async (slot) => {
        const cfg = await decryptPoolItem(slot)
        if (!cfg || cfg.mode === "direct" || !cfg.host || !cfg.port) return { id: slot.id, ok: false }
        const probe = await probeProxyNode(cfg, 4_000)
        return { id: slot.id, ok: probe.ok }
      }))
      probed += results.length
      for (const r of results) {
        if (r.ok) liveIds.add(r.id)
        else deadIds.add(r.id)
      }
      if (liveIds.size > 0) break // one working node is enough for a single account
    }
    const { pool: next, chosen } = planSinglePoolSwap(pool, accountId, liveIds, deadIds)
    writePoolStore(next)
    if (!chosen) {
      return { assigned: false as const, probed, removed: deadIds.size }
    }
    const cfg = await decryptPoolItem(chosen)
    if (!cfg || cfg.mode === "direct" || !cfg.host || !cfg.port) {
      return { assigned: false as const, probed, removed: deadIds.size }
    }
    const view = await saveProxyConfigUnlocked(accountId, cfg)
    return { assigned: true as const, view, probed, removed: deadIds.size }
  })
}

export interface ImportedProxyNode {
  mode: Exclude<MuseProxyMode, "direct">
  host: string
  port: number
  username?: string
  password?: string
}

export async function reimportProxyConfigs(
  nodes: ImportedProxyNode[],
  accountIds: string[]
): Promise<{ pool: number; accounts: number }> {
  const available = await safeStorage.isAsyncEncryptionAvailable()
  if (!available) throw new Error("safeStorage encryption unavailable")
  const pool: StoredPoolItem[] = []
  for (let i = 0; i < nodes.length; i++) {
    const enc = await safeStorage.encryptStringAsync(JSON.stringify(nodes[i]))
    pool.push({ id: `px_reimport_${i.toString(36)}_${Math.random().toString(36).slice(2, 7)}`, enc: enc.toString("base64") })
  }
  const store: StoreFile = {}
  for (let i = 0; i < accountIds.length; i++) {
    const node = nodes[i % nodes.length]
    const enc = await safeStorage.encryptStringAsync(JSON.stringify(node))
    store[accountIds[i]] = { enc: enc.toString("base64") }
  }
  await withProxyStoreLock(() => {
    writePoolStore(pool)
    writeStore(store)
    proxyConfigCache.clear()
  })
  return { pool: pool.length, accounts: Object.keys(store).length }
}

export async function getProxyPoolItemSecret(id: string): Promise<ImportedProxyNode | null> {
  const item = readPoolStore().find((x) => x.id === id)
  if (!item) return null
  const cfg = await decryptPoolItem(item)
  if (!cfg || cfg.mode === "direct" || !cfg.host || !cfg.port) return null
  return {
    mode: cfg.mode as Exclude<MuseProxyMode, "direct">,
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    password: cfg.password
  }
}