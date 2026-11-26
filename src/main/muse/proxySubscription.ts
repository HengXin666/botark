import { fetchSubscriptionText, parseSubscription, subscriptionNodesToLines, maskSubscriptionUrl, selectProxyNodes, type ProxySelectionCriteria } from './subscription'
import type { MuseProxyConfig, MuseProxyMode } from './accountProxy'
import { importProxyPool } from './accountProxy'

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
      rawScheme === "socks5h" ? "socks5h" : rawScheme === "socks5" ? "socks5" : rawScheme === "https" ? "https" : "http"
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
