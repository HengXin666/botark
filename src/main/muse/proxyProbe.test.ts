import { describe, expect, it } from 'vitest'
import { buildAccountProxyUrl } from './proxyProbe'

describe('buildAccountProxyUrl', () => {
  it('preserves the https proxy scheme', () => {
    expect(buildAccountProxyUrl({ mode: 'https', host: '203.0.113.9', port: 443 }))
      .toBe('https://203.0.113.9:443')
  })

  it('keeps http and socks schemes', () => {
    expect(buildAccountProxyUrl({ mode: 'http', host: '203.0.113.9', port: 8080 }))
      .toBe('http://203.0.113.9:8080')
    expect(buildAccountProxyUrl({ mode: 'socks5h', host: '203.0.113.9', port: 1080 }))
      .toBe('socks5h://203.0.113.9:1080')
  })
})
