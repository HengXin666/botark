import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'

import type { MuseProxyConfig } from './accountProxy'

export function buildAccountProxyUrl(cfg: MuseProxyConfig): string | null {
  if (cfg.mode === 'direct' || !cfg.host || !cfg.port) return null
  const auth =
    cfg.username && cfg.password
      ? `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password)}@`
      : cfg.username
        ? `${encodeURIComponent(cfg.username)}@`
        : ''
  const scheme = cfg.mode === 'http' ? 'http' : cfg.mode
  return `${scheme}://${auth}${cfg.host}:${cfg.port}`
}

/** Verify a proxy endpoint can actually reach the public internet. */
export async function probeProxyNode(
  cfg: MuseProxyConfig,
  timeoutMs = 1500
): Promise<{ ok: boolean; egressIp?: string; error?: string }> {
  if (cfg.mode === 'direct' || !cfg.host || !cfg.port) return { ok: false, error: 'no endpoint' }
  const url = buildAccountProxyUrl(cfg)
  if (!url) return { ok: false, error: 'invalid endpoint' }
  const override = process.env.BOTARK_PROXY_PROBE_URL
  if (override && cfg.mode === 'http') {
    return new Promise((resolve) => {
      const http = require('node:http') as typeof import('node:http')
      const basic = 'Basic ' + Buffer.from((cfg.username || '') + ':' + (cfg.password || '')).toString('base64')
      const req = http.request({ host: cfg.host, port: cfg.port, method: 'GET', path: override, timeout: timeoutMs,
        headers: { 'Proxy-Authorization': basic, 'Host': new URL(override).host } }, (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve({ ok: false, error: 'status ' + res.statusCode }); return }
        let body = ''
        res.on('data', (c) => { body += c.toString() })
        res.on('end', () => { const t = body.trim(); resolve({ ok: t.startsWith('SELFTEST-NODE-OK'), egressIp: t }) })
      })
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }) })
      req.on('error', (e) => resolve({ ok: false, error: e.message }))
      req.end()
    })
  }
  const target = override || 'https://api.ipify.org'
  return new Promise((resolve) => {
    const http = require('node:https') as typeof import('node:https')
    const agent = cfg.mode === 'socks5' || cfg.mode === 'socks5h'
      ? (new SocksProxyAgent(url) as unknown as import('node:https').Agent)
      : (new HttpsProxyAgent(url) as unknown as import('node:https').Agent)
    const req = http.get(target, { agent, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve({ ok: false, error: 'status ' + res.statusCode }); return }
      let body = ''
      res.on('data', (c) => { body += c.toString() })
      res.on('end', () => { const t = body.trim(); resolve({ ok: /^\d{1,3}(\.\d{1,3}){3}$/.test(t), egressIp: t }) })
    })
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }) })
    req.on('error', (e) => resolve({ ok: false, error: e.message }))
  })
}