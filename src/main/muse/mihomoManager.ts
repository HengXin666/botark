import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function log(msg: string, err?: unknown): void {
  if (err) console.warn(msg, err instanceof Error ? err.message : err)
  else console.warn(msg)
}

export interface MihomoNode {
  server: string
  port: number
  uuid: string
  tls: boolean
  servername: string
  network: 'ws' | 'tcp'
  wsPath: string
  wsHost: string
  realityPublicKey?: string
  realityShortId?: string
}

export interface ProxyRelayNode {
  mode: 'http' | 'socks5'
  host: string
  port: number
  username?: string
  password?: string
}

interface RelayAuth {
  username: string
  password: string
}

interface Inbound {
  name: string
  type: 'socks'
  port: number
  listen: string
  proxy: string
  users?: RelayAuth[]
}

const BASE_PORT = 18800
const MAX_PORTS = 1200
const RELAY_BASE_PORT = 29800
const MAX_RELAY_PORTS = 200
const START_TIMEOUT_MS = 8000

let child: ChildProcess | null = null
let nextPort = BASE_PORT
let nextRelayPort = RELAY_BASE_PORT
const nodeByPort = new Map<number, MihomoNode>()
const relayByPort = new Map<number, ProxyRelayNode>()
let relayAuthCache: RelayAuth | null = null

function binaryPath(): string {
  const env = process.env['BOTARK_MIHOMO_BIN']
  if (env && existsSync(env)) return env
  const candidates = [
    join(app.getAppPath(), 'resources', 'mihomo'),
    join(process.resourcesPath || '', 'mihomo'),
    '/home/hx/.local/bin/mihomo',
    '/usr/local/bin/mihomo'
  ]
  for (const c of candidates) if (c && existsSync(c)) return c
  return 'mihomo'
}

function configDir(): string {
  const dir = join(app.getPath('userData'), 'mihomo')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function relayAuthPath(): string {
  return join(configDir(), 'relay-auth.json')
}

/** Stable LAN listener credentials for the mobile proxy gateway. */
export function relayAuth(): RelayAuth {
  if (relayAuthCache) return relayAuthCache
  const file = relayAuthPath()
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<RelayAuth>
      if (parsed.username && parsed.password) {
        relayAuthCache = { username: parsed.username, password: parsed.password }
        return relayAuthCache
      }
    }
  } catch {
    /* regenerate below */
  }
  const generated: RelayAuth = {
    username: 'botark_' + randomBytes(4).toString('hex'),
    password: randomBytes(18).toString('base64url')
  }
  try {
    writeFileSync(file, JSON.stringify(generated), { encoding: 'utf8', mode: 0o600 })
  } catch {
    /* best effort; still usable in-memory */
  }
  relayAuthCache = generated
  return generated
}

function toProxy(node: MihomoNode, name: string): Record<string, unknown> {
  const p: Record<string, unknown> = {
    name,
    type: 'vless',
    server: node.server,
    port: node.port,
    uuid: node.uuid,
    tls: node.tls,
    servername: node.servername,
    'skip-cert-verify': true
  }
  if (node.realityPublicKey) {
    p['reality-opts'] = { 'public-key': node.realityPublicKey, 'short-id': node.realityShortId || '' }
    p['client-fingerprint'] = 'chrome'
  }
  if (node.network === 'ws') {
    p['network'] = 'ws'
    p['ws-opts'] = { path: node.wsPath || '/', headers: { Host: node.wsHost || node.servername } }
  } else {
    p['network'] = 'tcp'
  }
  return p
}

function toRelayProxy(node: ProxyRelayNode, name: string): Record<string, unknown> {
  const p: Record<string, unknown> = {
    name,
    type: node.mode,
    server: node.host,
    port: node.port
  }
  if (node.username) p['username'] = node.username
  if (node.password) p['password'] = node.password
  return p
}

function buildConfig(): string {
  const proxies: Record<string, unknown>[] = [
    ...[...nodeByPort.entries()].map(([port, node]) => toProxy(node, 'n' + port)),
    ...[...relayByPort.entries()].map(([port, node]) => toRelayProxy(node, 'r' + port))
  ]
  const auth = relayAuth()
  const listeners: Inbound[] = [
    ...[...nodeByPort.keys()].map((port) => ({
      name: 's' + port,
      type: 'socks' as const,
      port,
      listen: '127.0.0.1',
      proxy: 'n' + port
    })),
    ...[...relayByPort.keys()].map((port) => ({
      name: 'rs' + port,
      type: 'socks' as const,
      port,
      listen: '0.0.0.0',
      proxy: 'r' + port,
      users: [auth]
    }))
  ]
  const cfg = {
    'mixed-port': 0,
    'allow-lan': true,
    mode: 'global',
    'log-level': 'silent',
    proxies,
    listeners,
    rules: ['MATCH,DIRECT']
  }
  return JSON.stringify(cfg, null, 2)
}

function stopChild(): void {
  if (child && !child.killed) {
    try {
      child.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
  child = null
}

async function writeAndRestart(): Promise<void> {
  const dir = configDir()
  const cfgPath = join(dir, 'config.json')
  writeFileSync(cfgPath, buildConfig(), 'utf8')
  stopChild()
  const bin = binaryPath()
  const proc = spawn(bin, ['-d', dir, '-f', cfgPath], { stdio: 'ignore' })
  child = proc
  await new Promise<void>((resolve) => {
    let settled = false
    const done = (): void => {
      if (!settled) {
        settled = true
        resolve()
      }
    }
    proc.on('error', (err) => {
      log('[mihomo] spawn error', err)
      done()
    })
    proc.on('exit', (code) => {
      if (code !== 0) log('[mihomo] exited early code=' + code)
      done()
    })
    setTimeout(done, START_TIMEOUT_MS)
  })
  log('[mihomo] running pid=' + (proc.pid || 0) + ' nodes=' + nodeByPort.size)
}

/** Assign a stable local socks port to a protocol node, starting mihomo if needed. */
export async function ensureNodePort(node: MihomoNode): Promise<number> {
  for (const [port, existing] of nodeByPort.entries()) {
    if (existing.server === node.server && existing.port === node.port && existing.uuid === node.uuid) return port
  }
  if (nodeByPort.size >= MAX_PORTS) throw new Error('mihomo node capacity reached')
  const port = nextPort++
  nodeByPort.set(port, node)
  await writeAndRestart()
  return port
}

/** Assign ports to many nodes at once, writing the config and starting mihomo a single time. */
export async function ensureNodesPorts(
  nodes: MihomoNode[],
  options?: { replace?: boolean }
): Promise<number[]> {
  const ports: number[] = []
  let changed = false
  if (options?.replace) {
    const wanted = new Set(nodes.map((node) => node.server + ':' + node.port + ':' + node.uuid))
    for (const [port, existing] of nodeByPort.entries()) {
      if (!wanted.has(existing.server + ':' + existing.port + ':' + existing.uuid)) {
        nodeByPort.delete(port)
        changed = true
      }
    }
  }
  for (const node of nodes) {
    let found = 0
    for (const [port, existing] of nodeByPort.entries()) {
      if (existing.server === node.server && existing.port === node.port && existing.uuid === node.uuid) { found = port; break }
    }
    if (!found) {
      if (nodeByPort.size >= MAX_PORTS) { ports.push(0); continue }
      found = nextPort++
      nodeByPort.set(found, node)
      changed = true
    }
    ports.push(found)
  }
  if (changed) {
    await writeAndRestart()
    persistMihomoBindings()
  }
  return ports
}

/** Expose local http/socks upstreams through authenticated SOCKS listeners on the LAN. */
export async function ensureProxyRelays(nodes: ProxyRelayNode[]): Promise<number[]> {
  const ports: number[] = []
  let changed = false
  for (const node of nodes) {
    const key = `${node.mode}://${node.username || ''}@${node.host}:${node.port}`
    let found = 0
    for (const [port, existing] of relayByPort.entries()) {
      const existingKey = `${existing.mode}://${existing.username || ''}@${existing.host}:${existing.port}`
      if (existingKey === key) {
        found = port
        break
      }
    }
    if (!found) {
      if (relayByPort.size >= MAX_RELAY_PORTS) {
        ports.push(0)
        continue
      }
      found = nextRelayPort++
      relayByPort.set(found, node)
      changed = true
    }
    ports.push(found)
  }
  if (changed) await writeAndRestart()
  return ports
}
/** Drop all node-port bindings and stop mihomo. */
export function resetMihomo(): void {
  nodeByPort.clear()
  relayByPort.clear()
  nextPort = BASE_PORT
  nextRelayPort = RELAY_BASE_PORT
  stopChild()
  const cfgPath = join(configDir(), 'config.json')
  try {
    writeFileSync(cfgPath, JSON.stringify({ 'mixed-port': 0, proxies: [], listeners: [], rules: ['MATCH,DIRECT'] }, null, 2), 'utf8')
  } catch {
    /* best effort */
  }
}

export function stopMihomo(): void {
  stopChild()
}

export function mihomoStatus(): { running: boolean; nodes: number; ports: string[] } {
  return { running: Boolean(child && !child.killed), nodes: nodeByPort.size, ports: [...nodeByPort.keys()].map(String) }
}

/** Load node bindings persisted from a prior session and restart mihomo for them. */
export async function restoreMihomoFromFile(): Promise<void> {
  const f = join(configDir(), 'bindings.json')
  if (!existsSync(f)) return
  try {
    const parsed = JSON.parse(readFileSync(f, 'utf8')) as
      | Array<{ port: number; node: MihomoNode }>
      | { nodes?: Array<{ port: number; node: MihomoNode }>; relays?: Array<{ port: number; relay: ProxyRelayNode }> }
    const nodes = Array.isArray(parsed) ? parsed : parsed.nodes || []
    const relays = Array.isArray(parsed) ? [] : parsed.relays || []
    for (const item of nodes) {
      nodeByPort.set(item.port, item.node)
      if (item.port >= nextPort) nextPort = item.port + 1
    }
    for (const item of relays) {
      relayByPort.set(item.port, item.relay)
      if (item.port >= nextRelayPort) nextRelayPort = item.port + 1
    }
    if (nodeByPort.size > 0 || relayByPort.size > 0) await writeAndRestart()
  } catch (err) {
    log('[mihomo] restore failed', err)
  }
}

/** Persist current node-port bindings so they survive a restart. */
export function persistMihomoBindings(): void {
  const data = {
    nodes: [...nodeByPort.entries()].map(([port, node]) => ({ port, node })),
    relays: [...relayByPort.entries()].map(([port, relay]) => ({ port, relay }))
  }
  try {
    writeFileSync(join(configDir(), 'bindings.json'), JSON.stringify(data), 'utf8')
  } catch (err) {
    log('[mihomo] persist failed', err)
  }
}
