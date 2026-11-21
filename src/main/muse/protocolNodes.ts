import * as http from 'node:http'
import { ensureNodesPorts, type MihomoNode } from './mihomoManager'

interface NodeMaintItem {
  server?: string
  port?: number
  score?: number
  extra?: { uri?: string }
}

export interface ProtocolLiveNode {
  server: string
  port: number
  score: number
  uri: string
  localPort: number
  egressIp?: string
}

const BASE_URL = 'http://127.0.0.1:28530'
const PROTOCOLS = ['vless'] as const
const PAGE = 500

function getJson(url: string): Promise<unknown> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 12000 }, (res) => {
      let b = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (b += c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(b))
        } catch {
          resolve(null)
        }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
  })
}

function parseVless(uri: string): MihomoNode | null {
  try {
    const u = new URL(uri)
    if (u.protocol !== 'vless:') return null
    const q = u.searchParams
    const tls = q.get('security') === 'tls' || q.get('security') === 'reality'
    const network = q.get('type') === 'ws' ? 'ws' : 'tcp'
    const node: MihomoNode = {
      server: u.hostname,
      port: u.port ? Number(u.port) : 443,
      uuid: decodeURIComponent(u.username),
      tls,
      servername: q.get('sni') || q.get('host') || u.hostname,
      network,
      wsPath: q.get('path') || '/',
      wsHost: q.get('host') || q.get('sni') || u.hostname
    }
    if (q.get('security') === 'reality') {
      node.realityPublicKey = q.get('pbk') || undefined
      node.realityShortId = q.get('sid') || undefined
    }
    if (!node.server || !node.uuid) return null
    return node
  } catch {
    return null
  }
}

function probeLocal(port: number, timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    let done = false
    const fin = (v?: string): void => {
      if (!done) {
        done = true
        resolve(v)
      }
    }
    try {
      const agent = new (require('socks-proxy-agent').SocksProxyAgent)('socks5h://127.0.0.1:' + port)
      const req = http.get('https://api.ipify.org', { agent, timeout: timeoutMs }, (res) => {
        let b = ''
        res.on('data', (c) => (b += c))
        res.on('end', () => fin(res.statusCode === 200 && b.includes('.') ? b.trim() : undefined))
      })
      req.on('error', () => fin())
      req.on('timeout', () => {
        req.destroy()
        fin()
      })
    } catch {
      fin()
    }
    setTimeout(() => fin(), timeoutMs + 500)
  })
}

/** Pull protocol (vless) nodes from node-maint, verify each through mihomo, keep live ones. */
export async function syncProtocolNodes(limit = 4000, onProgress?: (p: { done: number; alive: number; total: number }) => void): Promise<ProtocolLiveNode[]> {
  const raw: Array<{ uri: string; score: number }> = []
  for (const proto of PROTOCOLS) {
    for (let off = 0; off < limit; off += PAGE) {
      const data = (await getJson(BASE_URL + '/api/nodes?protocol=' + proto + '&quality=ok&limit=' + PAGE + '&offset=' + off)) as {
        items?: NodeMaintItem[]
      } | null
      const items = data?.items || []
      if (items.length === 0) break
      for (const it of items) {
        const uri = it.extra?.uri
        if (uri) raw.push({ uri, score: it.score || 0 })
      }
      if (items.length < PAGE) break
    }
  }
  const seen = new Set<string>()
  const candidates: Array<{ node: MihomoNode; uri: string; score: number }> = []
  for (const r of raw) {
    const node = parseVless(r.uri)
    if (!node) continue
    const key = node.server + ':' + node.port + ':' + node.uuid
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ node, uri: r.uri, score: r.score })
  }
  const total = candidates.length
  const ports = await ensureNodesPorts(candidates.map((c) => c.node))
  const live: ProtocolLiveNode[] = []
  const CONC = 80
  let idx = 0
  let done = 0
  const worker = async (): Promise<void> => {
    while (idx < candidates.length) {
      const i = idx++
      const port = ports[i] || 0
      const cand = candidates[i]
      let egress: string | undefined
      if (port > 0) egress = await probeLocal(port, 8000)
      done++
      if (port > 0 && egress) {
        live.push({ server: cand.node.server, port: cand.node.port, score: cand.score, uri: cand.uri, localPort: port, egressIp: egress })
      }
      if (onProgress && done % 20 === 0) onProgress({ done, alive: live.length, total })
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()))
  if (onProgress) onProgress({ done, alive: live.length, total })
  live.sort((a, b) => b.score - a.score)
  return live
}
