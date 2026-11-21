/**
 * Per-account BotHub client egress proxy (not a Muse RPC).
 * Persist via Electron safeStorage; apply to session partition + Noise WSS agent.
 */
import { join } from "node:path"
import { app, safeStorage, session as electronSession } from "electron"
import { HttpsProxyAgent } from "https-proxy-agent"
import { SocksProxyAgent } from "socks-proxy-agent"
import type { Agent } from "node:https"
import { partitionForAccount } from "../webContentsViewManager"
import { readJsonFile, writeJsonAtomic } from "../jsonFile"
import { createMutex, planPoolAssignment, releasePoolSlot } from "@shared/proxyPool"
import { fetchSubscriptionText, parseSubscription, subscriptionNodesToLines, maskSubscriptionUrl, selectProxyNodes, type ProxySelectionCriteria } from './subscription'

/** One lock for both proxy files: every change is read-modify-write across awaits. */
const withProxyStoreLock = createMutex()

export type MuseProxyMode = "direct" | "http" | "socks5" | "socks5h"

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

function normalize(cfg: MuseProxyConfig | null | undefined): MuseProxyConfig {
  if (!cfg || cfg.mode === "direct") return { mode: "direct" }
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

export async function loadProxyConfig(accountId: string): Promise<MuseProxyConfig> {
  const entry = readStore()[accountId]
  if (!entry?.enc) return { mode: "direct" }
  let available = false
  try {
    available = await safeStorage.isAsyncEncryptionAvailable()
  } catch {
    available = false
  }
  if (!available) throw new ProxyConfigUnreadableError()
  try {
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(entry.enc, "base64"))
    return normalize(JSON.parse(decrypted.result) as MuseProxyConfig)
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
  await applyProxyToPartition(accountId, { mode: "direct" })
}

export function buildAccountProxyUrl(cfg: MuseProxyConfig): string | null {
  if (cfg.mode === "direct" || !cfg.host || !cfg.port) return null
  const auth =
    cfg.username && cfg.password
      ? `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password)}@`
      : cfg.username
        ? `${encodeURIComponent(cfg.username)}@`
        : ""
  const scheme = cfg.mode === "http" ? "http" : cfg.mode
  return `${scheme}://${auth}${cfg.host}:${cfg.port}`
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

/** Credentials for proxy auth, keyed by host:port; Chromium rejects userinfo in proxyRules. */
const proxyCredentials = new Map<string, { username: string; password: string }>()

export function registerProxyCredentials(host: string, port: number, username?: string, password?: string): void {
  if (username && password) proxyCredentials.set(`${host}:${port}`, { username, password })
  else proxyCredentials.delete(`${host}:${port}`)
}

export function lookupProxyCredentials(host: string, port: number): { username: string; password: string } | undefined {
  return proxyCredentials.get(`${host}:${port}`)
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

/** Node `ws` / HTTPS agent for Noise WSS (session.setProxy does not cover Node ws). */
export async function createProxyAgent(accountId: string): Promise<Agent | undefined> {
  const cfg = await loadProxyConfig(accountId)
  const url = buildAccountProxyUrl(cfg)
  if (!url) return undefined
  if (cfg.mode === "http") return new HttpsProxyAgent(url) as unknown as Agent
  return new SocksProxyAgent(url) as unknown as Agent
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
export interface SubscriptionResult {
  format: string
  total: number
  imported: number
  skipped: number
  candidates: number
  selected: number
  rejected: { reason: string; count: number }[]
  errors: string[]
  maskedUrl: string
}

/** Pulls one subscription URL, filters nodes by a live egress probe (see [self-contained subscription note](.agents/notes/implemented/architecture/2026-11-21-botark-subscription-self-contained.md)). */
export async function importSubscription(
  url: string,
  defaultMode: Exclude<MuseProxyMode, 'direct'> = 'http',
  criteria?: ProxySelectionCriteria
): Promise<SubscriptionResult> {
  const maskedUrl = maskSubscriptionUrl(url)
  let text: string
  try { text = await fetchSubscriptionText(url) }
  catch (err) { return { format: 'unknown', total: 0, imported: 0, skipped: 0, candidates: 0, selected: 0, rejected: [], errors: [(err as Error).message], maskedUrl } }
  const parsed = parseSubscription(text)
  const selection = await selectProxyNodes(parsed.nodes, criteria ?? {})
  const lines = subscriptionNodesToLines(selection.nodes)
  if (!lines) {
    return {
      format: parsed.format, total: parsed.skipped, imported: 0, skipped: parsed.skipped,
      candidates: selection.candidates, selected: 0, rejected: selection.rejected,
      errors: [...parsed.errors, 'no endpoint passed selection'], maskedUrl
    }
  }
  const res = await importProxyPool(lines, defaultMode)
  return {
    format: parsed.format, total: parsed.nodes.length + parsed.skipped, imported: res.added,
    skipped: parsed.skipped, candidates: selection.candidates, selected: selection.kept,
    rejected: selection.rejected, errors: parsed.errors, maskedUrl
  }
}

export function parseProxyLine(
  line: string,
  defaultMode: Exclude<MuseProxyMode, "direct"> = "socks5"
): MuseProxyConfig | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith("#")) return null

  const schemeMatch = /^(https?|socks5h?):\/\/(.+)$/i.exec(trimmed)
  if (schemeMatch) {
    const rawScheme = schemeMatch[1]!.toLowerCase()
    const mode: Exclude<MuseProxyMode, "direct"> =
      rawScheme === "socks5h" ? "socks5h" : rawScheme === "socks5" ? "socks5" : "http"
    const rest = schemeMatch[2]!.replace(/\/.*$/, "")
    const atIdx = rest.lastIndexOf("@")
    const hostPort = atIdx >= 0 ? rest.slice(atIdx + 1) : rest
    const authPart = atIdx >= 0 ? rest.slice(0, atIdx) : ""
    const colonIdx = hostPort.lastIndexOf(":")
    if (colonIdx <= 0) return null
    const host = hostPort.slice(0, colonIdx).trim()
    const port = Number(hostPort.slice(colonIdx + 1))
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null
    let username: string | undefined
    let password: string | undefined
    if (authPart) {
      const cIdx = authPart.indexOf(":")
      if (cIdx >= 0) {
        username = decodeURIComponent(authPart.slice(0, cIdx))
        password = decodeURIComponent(authPart.slice(cIdx + 1))
      } else {
        username = decodeURIComponent(authPart)
      }
    }
    return { mode, host, port, username: username || undefined, password: password || undefined }
  }

  // host:port:user:pass or user:pass@host:port or host:port
  if (trimmed.includes("@")) {
    const atIdx = trimmed.lastIndexOf("@")
    const authPart = trimmed.slice(0, atIdx)
    const hostPort = trimmed.slice(atIdx + 1)
    const [host, portStr] = hostPort.split(":")
    const port = Number(portStr)
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null
    const [u, ...pRest] = authPart.split(":")
    return {
      mode: defaultMode,
      host: host.trim(),
      port,
      username: u?.trim() || undefined,
      password: pRest.join(":") || undefined
    }
  }

  const parts = trimmed.split(":")
  if (parts.length >= 2) {
    const host = parts[0]!.trim()
    const port = Number(parts[1])
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null
    const username = parts[2]?.trim() || undefined
    const password = parts.length > 3 ? parts.slice(3).join(":") : undefined
    return { mode: defaultMode, host, port, username, password }
  }
  return null
}

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
export async function assignProxyPoolToAccounts(
  accountIds: string[],
  onAssigned?: (accountId: string) => Promise<void>,
  keep?: (accountId: string) => boolean
): Promise<{ assignedCount: number; items: MuseProxyPoolItemView[] }> {
  const configured = await withProxyStoreLock(async () => {
    const pool = readPoolStore()
    if (pool.length === 0 || accountIds.length === 0) return [] as string[]
    // Only live endpoints may be handed to an account. A dead node would
    // replace a working direct connection with a permanently failing one.
    const liveSlots: typeof pool = []
    const maxProbes = Math.min(pool.length, Math.max(accountIds.length * 3, 30))
    let probed = 0
    for (const slot of pool) {
      if (probed >= maxProbes || liveSlots.length >= accountIds.length) break
      const cfg = await decryptPoolItem(slot)
      if (!cfg || cfg.mode === "direct" || !cfg.host || !cfg.port) continue
      probed += 1
      const probe = await probeProxyNode(cfg)
      if (probe.ok) liveSlots.push(slot)
    }
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
    const finalPool = pool.map((s) => {
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
/** Verify a proxy endpoint can actually reach the public internet. */
export async function probeProxyNode(
  cfg: MuseProxyConfig,
  timeoutMs = 6000
): Promise<{ ok: boolean; egressIp?: string; error?: string }> {
  if (cfg.mode === "direct" || !cfg.host || !cfg.port) return { ok: false, error: "no endpoint" }
  const url = buildAccountProxyUrl(cfg)
  if (!url) return { ok: false, error: "invalid endpoint" }
  const override = process.env.BOTARK_PROXY_PROBE_URL
  if (override && cfg.mode === "http") {
    return new Promise((resolve) => {
      const http = require("node:http") as typeof import("node:http")
      const basic = "Basic " + Buffer.from((cfg.username || "") + ":" + (cfg.password || "")).toString("base64")
      const req = http.request({ host: cfg.host, port: cfg.port, method: "GET", path: override, timeout: timeoutMs,
        headers: { "Proxy-Authorization": basic, "Host": new URL(override).host } }, (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve({ ok: false, error: `status ${res.statusCode}` }); return }
        let body = ""
        res.on("data", (c) => { body += c.toString() })
        res.on("end", () => { const t = body.trim(); resolve({ ok: t.startsWith("SELFTEST-NODE-OK"), egressIp: t }) })
      })
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }) })
      req.on("error", (e) => resolve({ ok: false, error: e.message }))
      req.end()
    })
  }
  const target = override || "https://api.ipify.org"
  return new Promise((resolve) => {
    const http = require("node:https") as typeof import("node:https")
    const agent = cfg.mode === "socks5" || cfg.mode === "socks5h"
      ? (new SocksProxyAgent(url) as unknown as import("node:https").Agent)
      : (new HttpsProxyAgent(url) as unknown as import("node:https").Agent)
    const req = http.get(target, { agent, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve({ ok: false, error: `status ${res.statusCode}` }); return }
      let body = ""
      res.on("data", (c) => { body += c.toString() })
      res.on("end", () => { const t = body.trim(); resolve({ ok: /^\d{1,3}(\.\d{1,3}){3}$/.test(t), egressIp: t }) })
    })
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }) })
    req.on("error", (e) => resolve({ ok: false, error: e.message }))
  })
}