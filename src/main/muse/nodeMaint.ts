/**
 * Node-maint bridge: pull http proxy nodes ranked by score/latency from the
 * local node-maint intelligence service and keep only those that actually egress.
 * See .agents/notes/implemented/architecture/2026-11-21-botark-subscription-self-contained.md
 */
import { probeProxyNode } from './proxyProbe'

export interface NodeMaintRawNode {
  server: string
  port: number
  score: number
}

export interface NodeMaintLiveNode extends NodeMaintRawNode {
  egressIp?: string
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:28530'
const NODES_PATH = '/api/nodes'
const LIST_TIMEOUT_MS = 8000
const PROBE_CONCURRENCY = 32
const PROBE_TIMEOUT_MS = 2000
const DEFAULT_FETCH_LIMIT = 60

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

/** Pull http proxy nodes from node-maint ordered by score desc. */
export async function fetchNodeMaintHttpNodes(baseUrl = DEFAULT_BASE_URL, limit = DEFAULT_FETCH_LIMIT): Promise<NodeMaintRawNode[]> {
  const qs = '?protocol=http&sort=score&order=desc&limit=' + limit
  const data = (await fetchJson(baseUrl + NODES_PATH + qs, LIST_TIMEOUT_MS)) as { items?: unknown[] }
  const items = Array.isArray(data.items) ? data.items : []
  const out: NodeMaintRawNode[] = []
  for (const raw of items) {
    const n = raw as Record<string, unknown>
    const server = typeof n['server'] === 'string' ? n['server'] : ''
    const port = typeof n['port'] === 'number' ? n['port'] : 0
    const score = typeof n['score'] === 'number' ? n['score'] : 0
    if (server && port > 0) out.push({ server, port, score })
  }
  return out
}

function withHardTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))])
}

/** Keep only nodes whose http proxy endpoint actually reaches the internet. */
export async function checkNodeMaintNodes(
  nodes: NodeMaintRawNode[],
  concurrency = PROBE_CONCURRENCY,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<NodeMaintLiveNode[]> {
  const live: NodeMaintLiveNode[] = []
  const hardMs = timeoutMs + 300
  for (let i = 0; i < nodes.length; i += concurrency) {
    const slice = nodes.slice(i, i + concurrency)
    const results = await Promise.all(slice.map(async (n) => {
      const probe = await withHardTimeout(
        probeProxyNode({ mode: 'http', host: n.server, port: n.port }, timeoutMs),
        hardMs,
        { ok: false as const }
      )
      return probe.ok ? { ...n, egressIp: (probe as { egressIp?: string }).egressIp } : null
    }))
    for (const r of results) if (r) live.push(r)
  }
  return live
}

/** Pull, verify and return live node-maint http nodes ranked by score. */
export async function syncNodeMaintLiveNodes(baseUrl = DEFAULT_BASE_URL, limit = DEFAULT_FETCH_LIMIT): Promise<NodeMaintLiveNode[]> {
  const raw = await fetchNodeMaintHttpNodes(baseUrl, limit)
  const live = await checkNodeMaintNodes(raw)
  return live.sort((a, b) => b.score - a.score)
}
