/**
 * Remote subscription fetcher and dependency-free format sniffer.
 * Detection is content-based only: Content-Type is ignored because some
 * providers return text/html for a base64 payload.
 */

export type SubscriptionFormat = 'clash-yaml' | 'base64-uri' | 'uri-list' | 'unknown'

export interface SubscriptionNode {
  mode: 'http' | 'socks5'
  host: string
  port: number
  username?: string
  password?: string
}

export interface SubscriptionParseResult {
  nodes: SubscriptionNode[]
  format: SubscriptionFormat
  skipped: number
  errors: string[]
}

export const SUBSCRIPTION_UA = 'clash-verge/v2.0.3 mihomo/1.19.29'

const ENDPOINT_SCHEMES = new Set(['http', 'https', 'socks5', 'socks5h'])

/** Echo/log form: scheme + host + short path prefix, query and token removed. */
export function maskSubscriptionUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '(subscription)'
    const prefix = parsed.pathname.slice(0, 8)
    return `${parsed.protocol}//${parsed.host}${prefix}...(masked)`
  } catch {
    return '(subscription)'
  }
}

/** Fetch a subscription over the system-aware Electron/Node transport. Errors never echo the token. */
export async function fetchSubscriptionText(url: string): Promise<string> {
  const target = (url ?? '').trim()
  let validated: URL
  try {
    validated = new URL(target)
  } catch {
    throw new Error('[subscription] invalid URL (masked)')
  }
  if (validated.protocol !== 'http:' && validated.protocol !== 'https:') {
    throw new Error(`[subscription] unsupported protocol for ${maskSubscriptionUrl(target)}`)
  }
  const { systemAwareFetch } = await import('../proxyTransport')
  let res: Response
  try {
    res = await systemAwareFetch(target, {
      headers: { 'User-Agent': SUBSCRIPTION_UA, Accept: '*/*' },
      signal: AbortSignal.timeout(25_000)
    })
  } catch (err) {
    const name = err instanceof Error ? err.name : 'unknown error'
    throw new Error(`[subscription] fetch failed for ${maskSubscriptionUrl(target)}: ${name}`)
  }
  if (!res.ok) {
    throw new Error(`[subscription] fetch failed for ${maskSubscriptionUrl(target)}: HTTP ${res.status}`)
  }
  let text: string
  try {
    text = await res.text()
  } catch {
    throw new Error(`[subscription] response unreadable for ${maskSubscriptionUrl(target)}`)
  }
  if (!text.trim()) throw new Error(`[subscription] empty body from ${maskSubscriptionUrl(target)}`)
  return text
}

function looksLikeClashYaml(text: string): boolean {
  return /^\s*proxies\s*:/m.test(text)
}

function tryBase64Text(text: string): string | null {
  const compact = text.replace(/\s+/g, '')
  if (compact.length < 16 || !/^[A-Za-z0-9+/=_-]+$/.test(compact)) return null
  const normalized = compact.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  let raw: Buffer
  try {
    raw = Buffer.from(padded, 'base64')
  } catch {
    return null
  }
  if (!raw.length) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    return null
  }
}

/** Sniff the payload by content and return usable http/socks5 endpoints plus a skip report. */
export function parseSubscription(text: string): SubscriptionParseResult {
  const body = (text ?? '').trim()
  if (!body) return { nodes: [], format: 'unknown', skipped: 0, errors: ['subscription content is empty'] }

  if (looksLikeClashYaml(body)) return parseClashYaml(body, 'clash-yaml')

  const decoded = tryBase64Text(body)
  if (decoded && decoded.includes('://')) {
    return looksLikeClashYaml(decoded)
      ? parseClashYaml(decoded, 'base64-uri')
      : parseUriList(decoded, 'base64-uri')
  }
  if (decoded && looksLikeClashYaml(decoded)) return parseClashYaml(decoded, 'base64-uri')

  const lines = body.split(/\r?\n/)
  if (lines.some((l) => l.includes('://')) || lines.some((l) => /^[^\s@/]+:\d{2,5}\s*$/.test(l.trim()))) {
    return parseUriList(body, 'uri-list')
  }
  return {
    nodes: [],
    format: 'unknown',
    skipped: 0,
    errors: ['unrecognized subscription format (no proxies:/base64/URI lines)']
  }
}

function skipSummary(schemes: Map<string, number>): string | null {
  if (!schemes.size) return null
  const count = [...schemes.values()].reduce((a, b) => a + b, 0)
  return `skipped ${count} node(s) with scheme(s) ${[...schemes.keys()].join(', ')}: they are not http/socks5 endpoints and were not added to the proxy pool`
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Parse one http(s)/socks5 URI into an endpoint. Unsupported schemes are not endpoints. */
function parseEndpointLine(line: string, mode: 'http' | 'socks5'): SubscriptionNode | null {
  const noFragment = line.split('#')[0]!
  const authority = noFragment.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?]/)[0]!
  const atIdx = authority.lastIndexOf('@')
  const hostPort = atIdx >= 0 ? authority.slice(atIdx + 1) : authority
  const authPart = atIdx >= 0 ? authority.slice(0, atIdx) : ''
  const colonIdx = hostPort.lastIndexOf(':')
  if (colonIdx <= 0) return null
  const host = hostPort.slice(0, colonIdx).trim().replace(/^\[|\]$/g, '')
  const port = Number(hostPort.slice(colonIdx + 1))
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null
  let username: string | undefined
  let password: string | undefined
  if (authPart) {
    const cIdx = authPart.indexOf(':')
    if (cIdx >= 0) {
      username = safeDecode(authPart.slice(0, cIdx))
      password = safeDecode(authPart.slice(cIdx + 1))
    } else {
      username = safeDecode(authPart)
    }
  }
  return {
    mode,
    host,
    port,
    ...(username ? { username } : {}),
    ...(password ? { password } : {})
  }
}

function parseUriList(text: string, format: SubscriptionFormat): SubscriptionParseResult {
  const nodes: SubscriptionNode[] = []
  const schemes = new Map<string, number>()
  const seen = new Set<string>()
  const errors: string[] = []
  let skipped = 0
  let malformed = 0
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(line)
    if (schemeMatch) {
      const scheme = schemeMatch[1]!.toLowerCase()
      if (ENDPOINT_SCHEMES.has(scheme)) {
        const node = parseEndpointLine(line, scheme === 'socks5' || scheme === 'socks5h' ? 'socks5' : 'http')
        if (node) {
          const key = `${node.mode}:${node.username ?? ''}:${node.host}:${node.port}`
          if (!seen.has(key)) {
            seen.add(key)
            nodes.push(node)
          }
        } else {
          malformed += 1
          skipped += 1
        }
      } else {
        schemes.set(scheme, (schemes.get(scheme) ?? 0) + 1)
        skipped += 1
      }
      continue
    }
    const bare = /^(\S+):(\d{2,5})$/.exec(line)
    if (bare) {
      const host = bare[1]!
      const port = Number(bare[2])
      if (host && Number.isInteger(port) && port >= 1 && port <= 65535) {
        const key = `http::${host}:${port}`
        if (!seen.has(key)) {
          seen.add(key)
          nodes.push({ mode: 'http', host, port })
        }
        continue
      }
    }
    malformed += 1
    skipped += 1
  }
  const summary = skipSummary(schemes)
  if (summary) errors.push(summary)
  if (malformed) errors.push(`skipped ${malformed} malformed or unrecognized line(s)`)
  if (!nodes.length && !schemes.size && !malformed) errors.push('no usable http/socks5 endpoints found in subscription')
  return { nodes, format, skipped, errors: errors.slice(0, 20) }
}

function assignPair(entry: Record<string, string>, pair: string): void {
  const idx = pair.indexOf(':')
  if (idx < 0) return
  const key = pair.slice(0, idx).trim().toLowerCase()
  const value = pair.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')
  if (key) entry[key] = value
}

/** Minimal Clash proxies: list scanner. No YAML dependency is introduced. */
function parseClashYaml(text: string, format: SubscriptionFormat): SubscriptionParseResult {
  const lines = text.split(/\r?\n/)
  const proxiesIdx = lines.findIndex((l) => /^\s*proxies\s*:/.test(l))
  if (proxiesIdx < 0) {
    return { nodes: [], format, skipped: 0, errors: ['clash yaml has no proxies: list'] }
  }
  const baseIndent = (lines[proxiesIdx]!.match(/^\s*/) ?? [''])[0]!.length
  const entries: Array<Record<string, string>> = []
  let current: Record<string, string> | null = null
  for (let i = proxiesIdx + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.trim() || /^\s*#/.test(line)) continue
    const indent = (line.match(/^\s*/) ?? [''])[0]!.length
    if (indent <= baseIndent) break
    const item = /^(\s*)-\s+(.*)$/.exec(line)
    if (item && indent <= baseIndent + 3) {
      current = {}
      entries.push(current)
      const rest = item[2]!.trim()
      if (rest.startsWith('{') && rest.endsWith('}')) {
        for (const pair of rest.slice(1, -1).split(',')) assignPair(current, pair)
      } else {
        assignPair(current, rest)
      }
      continue
    }
    if (current) assignPair(current, line.trim())
  }

  const nodes: SubscriptionNode[] = []
  const schemes = new Map<string, number>()
  const errors: string[] = []
  let skipped = 0
  let malformed = 0
  for (const entry of entries) {
    const type = (entry['type'] ?? '').toLowerCase()
    const host = (entry['server'] ?? '').trim()
    const port = Number(entry['port'])
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      malformed += 1
      skipped += 1
      continue
    }
    let mode: 'http' | 'socks5'
    if (type === 'http' || type === 'https') mode = 'http'
    else if (type === 'socks5' || type === 'socks5h' || type === 'socks') mode = 'socks5'
    else {
      const label = type || 'unknown'
      schemes.set(label, (schemes.get(label) ?? 0) + 1)
      skipped += 1
      continue
    }
    const username = (entry['username'] ?? '').trim() || undefined
    const password = entry['password'] !== undefined ? String(entry['password']) : undefined
    nodes.push({
      mode,
      host,
      port,
      ...(username ? { username } : {}),
      ...(password ? { password } : {})
    })
  }
  const summary = skipSummary(schemes)
  if (summary) errors.push(summary)
  if (malformed) errors.push(`skipped ${malformed} clash proxy(ies) with missing/invalid server or port`)
  if (!nodes.length && !schemes.size && !malformed) errors.push('clash yaml has no usable http/socks5 proxies')
  return { nodes, format, skipped, errors: errors.slice(0, 20) }
}

/** Render nodes as text lines that parseProxyLine accepts. */
export function subscriptionNodesToLines(nodes: readonly SubscriptionNode[]): string {
  return nodes
    .map((n) => {
      const auth =
        n.username && n.password
          ? `${encodeURIComponent(n.username)}:${encodeURIComponent(n.password)}@`
          : n.username
            ? `${encodeURIComponent(n.username)}@`
            : ''
      return `${n.mode}://${auth}${n.host}:${n.port}`
    })
    .join('\n')
}
