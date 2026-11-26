/**
 * Node-maint bridge: pull http/https proxy nodes ranked by score/latency from the
 * local node-maint intelligence service and keep only those that actually egress.
 * See .agents/notes/implemented/architecture/2026-11-21-botark-subscription-self-contained.md
 */
import { probeProxyNode } from './proxyProbe'

export type NodeMaintProtocol = 'http' | 'https'

export interface NodeMaintRawNode {
  server: string
  port: number
  score: number
  /** Endpoint protocol: an https node is a TLS-to-proxy listener, not a plain http one. */
  mode: NodeMaintProtocol
}

export interface NodeMaintLiveNode extends NodeMaintRawNode {
  egressIp?: string
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:28530'
const NODES_PATH = '/api/nodes'
const LIST_TIMEOUT_MS = 5000
const FETCH_ATTEMPTS = 3
const PROBE_CONCURRENCY = 64
const PROBE_TIMEOUT_MS = 3500
const DEFAULT_FETCH_LIMIT = 500

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const http = require('node:http') as typeof import('node:http')
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('status ' + res.statusCode)); return }
      let body = ''
      res.on('data', (c: Buffer) => { body += c.toString() })
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch (e) { reject(e) } })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.on('error', reject)
  })
}

/** Pull proxy nodes of one protocol from node-maint ordered by score desc. */
export async function fetchByProtocol(
  protocol: NodeMaintProtocol,
  baseUrl = DEFAULT_BASE_URL,
  limit = DEFAULT_FETCH_LIMIT
): Promise<NodeMaintRawNode[]> {
  const qs = '?protocol=' + protocol + '&sort=score&order=desc&limit=' + limit
  const data = (await fetchJson(baseUrl + NODES_PATH + qs, LIST_TIMEOUT_MS)) as { items?: unknown[] }
  const items = Array.isArray(data.items) ? data.items : []
  const out: NodeMaintRawNode[] = []
  for (const raw of items) {
    const n = raw as Record<string, unknown>
    const server = typeof n['server'] === 'string' ? n['server'] : ''
    const port = typeof n['port'] === 'number' ? n['port'] : 0
    const score = typeof n['score'] === 'number' ? n['score'] : 0
    if (server && port > 0) out.push({ server, port, score, mode: protocol })
  }
  return out
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * node-maint keeps one SQLite connection behind a threadpool; two /api/nodes
 * queries fired together intermittently answer 500. Retry, and fetch the two
 * protocols one after another so this client creates no such collision itself.
 */
async function fetchWithRetry(protocol: NodeMaintProtocol, baseUrl: string, limit: number): Promise<NodeMaintRawNode[]> {
  let last: unknown
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      return await fetchByProtocol(protocol, baseUrl, limit)
    } catch (err) {
      last = err
      if (attempt < FETCH_ATTEMPTS) await delay(150 * attempt)
    }
  }
  throw new Error(protocol + ' 查询失败: ' + (last instanceof Error ? last.message : String(last)))
}

function withHardTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))])
}

/** Keep only nodes whose proxy endpoint actually reaches the internet. */
export async function checkNodeMaintNodes(
  nodes: NodeMaintRawNode[],
  concurrency = PROBE_CONCURRENCY,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<NodeMaintLiveNode[]> {
  const live: NodeMaintLiveNode[] = []
  const hardMs = timeoutMs + 500
  for (let i = 0; i < nodes.length; i += concurrency) {
    const slice = nodes.slice(i, i + concurrency)
    const results = await Promise.all(slice.map(async (n) => {
      const probe = await withHardTimeout(
        probeProxyNode({ mode: n.mode, host: n.server, port: n.port }, timeoutMs),
        hardMs,
        { ok: false as const }
      )
      return probe.ok ? { ...n, egressIp: (probe as { egressIp?: string }).egressIp } : null
    }))
    for (const r of results) if (r) live.push(r)
  }
  return live
}

/** Pull http + https proxy nodes from node-maint and keep only those that egress. */
export async function syncNodeMaintLiveNodes(baseUrl = DEFAULT_BASE_URL, limit = DEFAULT_FETCH_LIMIT): Promise<NodeMaintLiveNode[]> {
  const failures: string[] = []
  const fetchOne = async (protocol: NodeMaintProtocol): Promise<NodeMaintRawNode[]> => {
    try {
      return await fetchWithRetry(protocol, baseUrl, limit)
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err))
      return []
    }
  }
  const httpNodes = await fetchOne('http')
  const httpsNodes = await fetchOne('https')
  if (httpNodes.length === 0 && httpsNodes.length === 0 && failures.length > 0) {
    throw new Error('node-maint 节点查询失败: ' + failures.join('; '))
  }
  const [httpLive, httpsLive] = await Promise.all([
    checkNodeMaintNodes(httpNodes),
    checkNodeMaintNodes(httpsNodes)
  ])
  const seen = new Set<string>()
  const live: NodeMaintLiveNode[] = []
  for (const n of [...httpLive, ...httpsLive]) {
    const key = n.mode + '://' + n.server + ':' + n.port
    if (seen.has(key)) continue
    seen.add(key)
    live.push(n)
  }
  return live.sort((a, b) => b.score - a.score)
}
