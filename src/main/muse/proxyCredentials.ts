import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import type { Agent } from 'node:https'
import type { MuseProxyConfig } from './accountProxy'
import { buildAccountProxyUrl } from './proxyProbe'
import { loadProxyConfig } from './accountProxy'

/** Credentials for proxy auth, keyed by host:port; Chromium rejects userinfo in proxyRules. */
const proxyCredentials = new Map<string, { username: string; password: string }>()

export function registerProxyCredentials(host: string, port: number, username?: string, password?: string): void {
  if (username && password) proxyCredentials.set(`${host}:${port}`, { username, password })
  else proxyCredentials.delete(`${host}:${port}`)
}

export function lookupProxyCredentials(host: string, port: number): { username: string; password: string } | undefined {
  return proxyCredentials.get(`${host}:${port}`)
}

/** Node agent for Noise WSS (session.setProxy does not cover Node ws). */
export async function createProxyAgent(accountId: string): Promise<Agent | undefined> {
  const cfg: MuseProxyConfig = await loadProxyConfig(accountId)
  const url = buildAccountProxyUrl(cfg)
  if (!url) return undefined
  if (cfg.mode === 'http') return new HttpsProxyAgent(url) as unknown as Agent
  return new SocksProxyAgent(url) as unknown as Agent
}