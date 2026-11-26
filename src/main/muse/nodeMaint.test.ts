import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { fetchByProtocol } from './nodeMaint'

describe('node-maint bridge', () => {
  it('keeps the endpoint protocol instead of downgrading https to http', async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ items: [{ server: '203.0.113.7', port: 8443, score: 12 }] }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address() as AddressInfo
    try {
      const https = await fetchByProtocol('https', 'http://127.0.0.1:' + address.port, 1)
      expect(https).toEqual([{ server: '203.0.113.7', port: 8443, score: 12, mode: 'https' }])
      const http = await fetchByProtocol('http', 'http://127.0.0.1:' + address.port, 1)
      expect(http[0]?.mode).toBe('http')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
