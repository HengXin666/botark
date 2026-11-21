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
export async function fetchByProtocol(protocol: string, baseUrl: string, limit: number): Promise<NodeMaintRawNode[]> {
  const qs = '?protocol=' + protocol + '&sort=score&order=desc&limit=' + limit
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


/** Probe an https (TLS) proxy endpoint by tunnelling to a plain-http target. */
async function probeHttpsProxy(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const { HttpsProxyAgent } = require('https-proxy-agent') as typeof import('https-proxy-agent')
  const http = require('node:http') as typeof import('node:http')
  const agent = new HttpsProxyAgent('https://' + host + ':' + port)
  return new Promise((resolve) => {
    const req = http.get('http://httpbin.org/ip', { agent, timeout: timeoutMs }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
  })
}

/** Check https nodes and append the live ones. */
async function checkHttpsNodes(nodes: NodeMaintRawNode[], concurrency = PROBE_CONCURRENCY, timeoutMs = PROBE_TIMEOUT_MS): Promise<NodeMaintLiveNode[]> {
  const live: NodeMaintLiveNode[] = []
  const hardMs = timeoutMs + 300
  for (let i = 0; i < nodes.length; i += concurrency) {
    const slice = nodes.slice(i, i + concurrency)
    const results = await Promise.all(slice.map(async (n) => {
      const ok = await Promise.race([
        probeHttpsProxy(n.server, n.port, timeoutMs),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), hardMs))
      ])
      return ok ? n : null
    }))
    for (const r of results) if (r) live.push(r)
  }
  return live
}
/** Pull http + https proxy nodes from node-maint and keep only those that egress. */
export async function syncNodeMaintLiveNodes(baseUrl = DEFAULT_BASE_URL, limit = DEFAULT_FETCH_LIMIT): Promise<NodeMaintLiveNode[]> {
  const [httpNodes, httpsNodes] = await Promise.all([
    fetchByProtocol('http', baseUrl, limit).catch(() => [] as NodeMaintRawNode[]),
    fetchByProtocol('https', baseUrl, limit).catch(() => [] as NodeMaintRawNode[])
  ])
  const [httpLive, httpsLive] = await Promise.all([
    checkNodeMaintNodes(httpNodes),
    checkHttpsNodes(httpsNodes)
  ])
  const seen = new Set<string>()
  const live: NodeMaintLiveNode[] = []
  for (const n of [...httpLive, ...httpsLive]) {
    const key = n.server + ':' + n.port
    if (seen.has(key)) continue
    seen.add(key)
    live.push(n)
  }
  return live.sort((a, b) => b.score - a.score)
}
