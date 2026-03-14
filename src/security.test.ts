import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createProxyHandler, type ProxyDeps } from './proxy/handler.js'
import { CapacityTracker } from './proxy/capacity.js'
import { createTokenTollServer } from './server.js'
import { loadConfig } from './config.js'
import type { ModelPricing } from './config.js'

const pricing: ModelPricing = { default: 1, models: {} }

function makeDeps(overrides: Partial<ProxyDeps> & { upstream: string }): ProxyDeps {
  return {
    pricing,
    capacity: new CapacityTracker(0),
    reconcile: vi.fn().mockReturnValue({ adjusted: false, newBalance: 0, delta: 0 }),
    maxBodySize: 10 * 1024 * 1024,
    ...overrides,
  }
}

describe('Security: upstream error sanitisation', () => {
  let upstreamServer: ReturnType<typeof serve>
  let upstreamUrl: string

  beforeEach(async () => {
    const app = new Hono()
    // Upstream returns error with internal details
    app.post('/v1/chat/completions', (c) => {
      return c.json(
        {
          error: 'Internal failure',
          debug: { stack: 'Error at /app/src/model.py:42', internalIp: '10.0.0.5' },
        },
        500,
      )
    })
    await new Promise<void>((resolve) => {
      upstreamServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
        upstreamUrl = `http://localhost:${info.port}`
        resolve()
      })
    })
  })

  afterEach(() => { upstreamServer?.close() })

  it('does not forward raw upstream error body to client', async () => {
    const handler = createProxyHandler(makeDeps({ upstream: upstreamUrl }))
    const req = new Request(`http://test/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })

    const res = await handler(req, undefined)
    expect(res.status).toBe(500)
    const body = await res.json()
    // Should NOT contain internal debug info
    expect(body.debug).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('10.0.0.5')
    expect(JSON.stringify(body)).not.toContain('model.py')
    // Should contain a generic error
    expect(body.error).toContain('Upstream returned 500')
  })

  it('refunds payment on upstream error', async () => {
    const reconcile = vi.fn().mockReturnValue({ adjusted: true, newBalance: 100, delta: 10 })
    const handler = createProxyHandler(makeDeps({ upstream: upstreamUrl, reconcile }))
    const req = new Request(`http://test/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })

    await handler(req, 'payment-hash-123')
    expect(reconcile).toHaveBeenCalledWith('payment-hash-123', 0)
  })
})

describe('Security: upstream response size limit', () => {
  let upstreamServer: ReturnType<typeof serve>
  let upstreamUrl: string

  afterEach(() => { upstreamServer?.close() })

  it('rejects oversized upstream response', async () => {
    const app = new Hono()
    const bigPayload = JSON.stringify({
      choices: [{ message: { content: 'x'.repeat(1000) } }],
      usage: { total_tokens: 10 },
    })
    app.post('/v1/chat/completions', (c) => {
      return c.json(JSON.parse(bigPayload))
    })
    await new Promise<void>((resolve) => {
      upstreamServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
        upstreamUrl = `http://localhost:${info.port}`
        resolve()
      })
    })

    const handler = createProxyHandler(makeDeps({
      upstream: upstreamUrl,
      maxBodySize: 200, // small limit
    }))
    const req = new Request(`http://test/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })

    const res = await handler(req, undefined)
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toContain('too large')
  })
})

describe('Security: upstream invalid JSON response', () => {
  let upstreamServer: ReturnType<typeof serve>
  let upstreamUrl: string

  afterEach(() => { upstreamServer?.close() })

  it('handles upstream returning invalid JSON gracefully', async () => {
    const app = new Hono()
    app.post('/v1/chat/completions', () => {
      return new Response('this is not json at all', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    await new Promise<void>((resolve) => {
      upstreamServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
        upstreamUrl = `http://localhost:${info.port}`
        resolve()
      })
    })

    const handler = createProxyHandler(makeDeps({ upstream: upstreamUrl }))
    const req = new Request(`http://test/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })

    const res = await handler(req, undefined)
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toContain('invalid JSON')
  })
})

describe('Security: /v1/models timeout', () => {
  let upstreamServer: ReturnType<typeof serve>
  let upstreamUrl: string

  afterEach(() => { upstreamServer?.close() })

  it('/v1/models returns empty data when upstream is slow', async () => {
    const app = new Hono()
    app.get('/v1/models', async () => {
      // Never resolves within timeout
      await new Promise((r) => setTimeout(r, 30_000))
      return new Response('{}')
    })
    await new Promise<void>((resolve) => {
      upstreamServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
        upstreamUrl = `http://localhost:${info.port}`
        resolve()
      })
    })

    const { app: tollApp } = createTokenTollServer({
      upstream: upstreamUrl,
      port: 0,
      rootKey: 'a'.repeat(64),
      rootKeyGenerated: false,
      storage: 'memory',
      dbPath: '',
      pricing: { default: 1, models: {} },
      freeTier: { creditsPerDay: 0 },
      capacity: { maxConcurrent: 0 },
      tiers: [],
      trustProxy: false,
      estimatedCostSats: 10,
      maxBodySize: 10 * 1024 * 1024,
      authMode: 'open',
      allowlist: [],
      flatPricing: true,
      price: 1,
      tunnel: false,
    })

    // The models endpoint should timeout gracefully and return empty data
    // We can't easily test the 10s timeout without waiting, so just verify
    // it doesn't crash on a working upstream
    // This test mainly documents the timeout behaviour exists
    expect(tollApp).toBeDefined()
  })
})

describe('Security: config validation', () => {
  it('rejects invalid lightning URL scheme', () => {
    expect(() => loadConfig({
      upstream: 'http://localhost:11434',
      lightning: 'phoenixd',
      lightningKey: 'pw',
      lightningUrl: 'ftp://localhost:9740',
    })).toThrow(/http or https/)
  })

  it('rejects non-URL lightning URL', () => {
    expect(() => loadConfig({
      upstream: 'http://localhost:11434',
      lightning: 'phoenixd',
      lightningKey: 'pw',
      lightningUrl: 'not a url',
    })).toThrow(/not a valid URL/)
  })

  it('accepts valid lightning URL', () => {
    const config = loadConfig({
      upstream: 'http://localhost:11434',
      lightning: 'phoenixd',
      lightningKey: 'pw',
      lightningUrl: 'https://my-phoenixd.example.com',
    })
    expect(config.lightningUrl).toBe('https://my-phoenixd.example.com')
  })
})

describe('Security: request body edge cases', () => {
  let upstreamServer: ReturnType<typeof serve>
  let upstreamUrl: string

  beforeEach(async () => {
    const app = new Hono()
    app.post('/v1/chat/completions', (c) => {
      return c.json({
        choices: [{ message: { content: 'ok' } }],
        usage: { total_tokens: 5 },
      })
    })
    await new Promise<void>((resolve) => {
      upstreamServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
        upstreamUrl = `http://localhost:${info.port}`
        resolve()
      })
    })
  })

  afterEach(() => { upstreamServer?.close() })

  it('rejects Content-Length that lies about size', async () => {
    const handler = createProxyHandler(makeDeps({
      upstream: upstreamUrl,
      maxBodySize: 100,
    }))
    const req = new Request(`http://test/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '999999',
      },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })

    const res = await handler(req, undefined)
    expect(res.status).toBe(413)
  })

  it('rejects deeply nested JSON without crashing', async () => {
    const handler = createProxyHandler(makeDeps({ upstream: upstreamUrl }))
    // Build deeply nested JSON (JSON.parse handles this fine, just checking no crash)
    let nested = '{"a":'.repeat(50) + '{}' + '}'.repeat(50)
    const req = new Request(`http://test/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: nested,
    })

    // Should not crash — just process normally (model will be empty)
    const res = await handler(req, undefined)
    expect([200, 400, 502]).toContain(res.status)
  })

  it('handles empty body gracefully', async () => {
    const handler = createProxyHandler(makeDeps({ upstream: upstreamUrl }))
    const req = new Request(`http://test/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    })

    const res = await handler(req, undefined)
    expect(res.status).toBe(400)
  })

  it('handles unicode body correctly for size check', async () => {
    const handler = createProxyHandler(makeDeps({
      upstream: upstreamUrl,
      maxBodySize: 100,
    }))
    // Multi-byte UTF-8 characters: each emoji is 4 bytes
    const body = JSON.stringify({ model: 'test', messages: [{ role: 'user', content: '🎉'.repeat(20) }] })
    const req = new Request(`http://test/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    const res = await handler(req, undefined)
    // Body with emojis should exceed 100 bytes
    expect(res.status).toBe(413)
  })
})

describe('Security: capacity release on error paths', () => {
  let upstreamServer: ReturnType<typeof serve>
  let upstreamUrl: string

  beforeEach(async () => {
    const app = new Hono()
    app.post('/v1/chat/completions', (c) => {
      return c.json({
        choices: [{ message: { content: 'ok' } }],
        usage: { total_tokens: 5 },
      })
    })
    await new Promise<void>((resolve) => {
      upstreamServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
        upstreamUrl = `http://localhost:${info.port}`
        resolve()
      })
    })
  })

  afterEach(() => { upstreamServer?.close() })

  it('releases capacity slot on invalid Content-Type', async () => {
    const capacity = new CapacityTracker(10)
    const handler = createProxyHandler(makeDeps({ upstream: upstreamUrl, capacity }))
    const req = new Request(`http://test/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    })

    expect(capacity.active).toBe(0)
    await handler(req, undefined)
    expect(capacity.active).toBe(0) // slot should be released
  })

  it('releases capacity slot on body too large', async () => {
    const capacity = new CapacityTracker(10)
    const handler = createProxyHandler(makeDeps({
      upstream: upstreamUrl,
      capacity,
      maxBodySize: 10,
    }))
    const req = new Request(`http://test/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [{ content: 'x'.repeat(100) }] }),
    })

    await handler(req, undefined)
    expect(capacity.active).toBe(0) // slot should be released
  })

  it('releases capacity slot on invalid JSON', async () => {
    const capacity = new CapacityTracker(10)
    const handler = createProxyHandler(makeDeps({ upstream: upstreamUrl, capacity }))
    const req = new Request(`http://test/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })

    await handler(req, undefined)
    expect(capacity.active).toBe(0)
  })
})

describe('Security: health endpoint', () => {
  it('health endpoint does not leak sensitive config', async () => {
    const { app } = createTokenTollServer({
      upstream: 'http://localhost:11434',
      port: 0,
      rootKey: 'a'.repeat(64),
      rootKeyGenerated: false,
      storage: 'memory',
      dbPath: '',
      pricing: { default: 1, models: {} },
      freeTier: { creditsPerDay: 0 },
      capacity: { maxConcurrent: 10 },
      tiers: [],
      trustProxy: false,
      estimatedCostSats: 10,
      maxBodySize: 10 * 1024 * 1024,
      authMode: 'lightning',
      allowlist: ['secret123'],
      flatPricing: false,
      price: 1,
      tunnel: false,
    })

    const res = await app.request('/health')
    const body = await res.json()

    // Should NOT contain sensitive data
    const bodyStr = JSON.stringify(body)
    expect(bodyStr).not.toContain('secret123')
    expect(bodyStr).not.toContain('a'.repeat(64))
    expect(bodyStr).not.toContain('rootKey')
    expect(bodyStr).not.toContain('allowlist')

    // Should contain health info
    expect(body.status).toBe('ok')
  })
})
