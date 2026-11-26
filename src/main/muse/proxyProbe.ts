import { HttpsProxyAgent } from 'https-proxy-agent'
import * as net from 'node:net'
import * as tls from 'node:tls'
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

type ProbeResult = { ok: boolean; egressIp?: string; error?: string }

/** Verify a proxy endpoint can actually reach the public internet. */
export async function probeProxyNode(
  cfg: MuseProxyConfig,
  timeoutMs = 1500
): Promise<ProbeResult> {
  if (cfg.mode === 'direct' || !cfg.host || !cfg.port) return { ok: false, error: 'no endpoint' }
  const url = buildAccountProxyUrl(cfg)
  if (!url) return { ok: false, error: 'invalid endpoint' }
  const override = process.env.BOTARK_PROXY_PROBE_URL
  if (override && cfg.mode === 'http') {
    return probeOverride(override, cfg, timeoutMs)
  }
  const target = override || 'https://api.ipify.org'
  if (cfg.mode === 'https') return probeHttpsProxy(cfg, target, timeoutMs)
  const https = require('node:https') as typeof import('node:https')
  const agent = cfg.mode === 'socks5' || cfg.mode === 'socks5h'
    ? (new SocksProxyAgent(url) as unknown as import('node:https').Agent)
    : (new HttpsProxyAgent(url) as unknown as import('node:https').Agent)

  return new Promise<ProbeResult>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: ProbeResult): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }
    let req: import('node:http').ClientRequest
    try {
      req = https.get(target, { agent, timeout: timeoutMs }, (res) => {
        if (res.statusCode !== 200) { res.resume(); finish({ ok: false, error: 'status ' + res.statusCode }); return }
        let body = ''
        res.on('data', (c) => { body += c.toString() })
        res.on('end', () => {
          const t = body.trim()
          finish({ ok: /^\d{1,3}(\.\d{1,3}){3}$/.test(t), egressIp: t })
        })
      })
    } catch (err) {
      finish({ ok: false, error: err instanceof Error ? err.message : String(err) })
      return
    }
    req.on('socket', (socket) => {
      socket.on('error', (err) => finish({ ok: false, error: err.message }))
    })
    req.on('timeout', () => { req.destroy(); finish({ ok: false, error: 'timeout' }) })
    req.on('error', (err) => finish({ ok: false, error: err.message }))
    timer = setTimeout(() => {
      try { req.destroy() } catch { /* already closed */ }
      finish({ ok: false, error: 'timeout' })
    }, timeoutMs + 800)
  })
}

/**
 * HTTPS (TLS-to-proxy) probe implemented on raw sockets. https-proxy-agent's
 * second TLS hop emits ECONNRESET on an internal TLSSocket without a listener,
 * which becomes an uncaughtException for every dead node. Owning both sockets
 * here keeps every error on a listener while keeping certificate verification
 * on (same policy Chromium applies to the real account proxy).
 */
function probeHttpsProxy(cfg: MuseProxyConfig, targetUrl: string, timeoutMs: number): Promise<ProbeResult> {
  let target: URL
  try {
    target = new URL(targetUrl)
  } catch {
    return Promise.resolve({ ok: false, error: 'invalid probe target' })
  }
  const targetPort = target.port ? Number(target.port) : target.protocol === 'https:' ? 443 : 80
  const targetHost = target.hostname

  return new Promise<ProbeResult>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: ProbeResult): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }
    let raw: tls.TLSSocket
    try {
      raw = tls.connect({
        host: cfg.host,
        port: cfg.port,
        servername: net.isIP(cfg.host || '') ? undefined : cfg.host,
        rejectUnauthorized: true,
        timeout: timeoutMs
      })
    } catch (err) {
      finish({ ok: false, error: err instanceof Error ? err.message : String(err) })
      return
    }
    raw.on('error', (err) => finish({ ok: false, error: err.message }))
    raw.on('timeout', () => { raw.destroy(); finish({ ok: false, error: 'timeout' }) })
    raw.once('secureConnect', () => {
      const auth = cfg.username && cfg.password
        ? 'Proxy-Authorization: Basic ' + Buffer.from(cfg.username + ':' + cfg.password).toString('base64') + '\r\n'
        : ''
      raw.write(
        'CONNECT ' + targetHost + ':' + targetPort + ' HTTP/1.1\r\n' +
        'Host: ' + targetHost + ':' + targetPort + '\r\n' +
        auth +
        'Proxy-Connection: close\r\n\r\n'
      )
    })
    let header = ''
    const onProxyData = (chunk: Buffer): void => {
      header += chunk.toString('latin1')
      const end = header.indexOf('\r\n\r\n')
      if (end < 0) return
      raw.removeListener('data', onProxyData)
      const status = Number((header.slice(0, end).split('\r\n')[0] || '').split(' ')[1])
      if (status !== 200) {
        raw.destroy()
        finish({ ok: false, error: 'proxy status ' + status })
        return
      }
      const path = target.pathname + target.search || '/'
      const request = 'GET ' + path + ' HTTP/1.1\r\nHost: ' + target.host + '\r\nConnection: close\r\n\r\n'
      if (target.protocol !== 'https:') {
        let body = ''
        raw.on('data', (c) => { body += c.toString() })
        raw.on('end', () => finish(parseProbeBody(body)))
        raw.write(request)
        return
      }
      let secure: tls.TLSSocket
      try {
        secure = tls.connect({ socket: raw, servername: targetHost, rejectUnauthorized: true, timeout: timeoutMs })
      } catch (err) {
        finish({ ok: false, error: err instanceof Error ? err.message : String(err) })
        return
      }
      let body = ''
      secure.on('error', (err) => finish({ ok: false, error: err.message }))
      secure.on('timeout', () => { secure.destroy(); finish({ ok: false, error: 'timeout' }) })
      secure.on('data', (c) => { body += c.toString() })
      secure.on('end', () => finish(parseProbeBody(body)))
      secure.once('secureConnect', () => secure.write(request))
    }
    raw.on('data', onProxyData)
    timer = setTimeout(() => {
      try { raw.destroy() } catch { /* already closed */ }
      finish({ ok: false, error: 'timeout' })
    }, timeoutMs + 800)
  })
}

function parseProbeBody(body: string): ProbeResult {
  const status = /^HTTP\/1\.[01] (\d{3})/.exec(body)
  if (!status || status[1] !== '200') return { ok: false, error: 'status ' + (status?.[1] || 'unknown') }
  const ip = body.split('\r\n\r\n')[1]?.trim() || ''
  return { ok: /^\d{1,3}(\.\d{1,3}){3}$/.test(ip), egressIp: ip }
}

function probeOverride(path: string, cfg: MuseProxyConfig, timeoutMs: number): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve) => {
    const http = require('node:http') as typeof import('node:http')
    const basic = 'Basic ' + Buffer.from((cfg.username || '') + ':' + (cfg.password || '')).toString('base64')
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: ProbeResult): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }
    const req = http.request({ host: cfg.host, port: cfg.port, method: 'GET', path, timeout: timeoutMs,
      headers: { 'Proxy-Authorization': basic, 'Host': new URL(path).host } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); finish({ ok: false, error: 'status ' + res.statusCode }); return }
      let body = ''
      res.on('data', (c) => { body += c.toString() })
      res.on('end', () => { const t = body.trim(); finish({ ok: t.startsWith('SELFTEST-NODE-OK'), egressIp: t }) })
    })
    req.on('socket', (socket) => { socket.on('error', (err) => finish({ ok: false, error: err.message })) })
    req.on('timeout', () => { req.destroy(); finish({ ok: false, error: 'timeout' }) })
    req.on('error', (e) => finish({ ok: false, error: e.message }))
    timer = setTimeout(() => { try { req.destroy() } catch { /* already closed */ }; finish({ ok: false, error: 'timeout' }) }, timeoutMs + 800)
    req.end()
  })
}
