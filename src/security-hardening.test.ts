import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createProxyHandler, type ProxyDeps } from './proxy/handler.js'
import { CapacityTracker } from './proxy/capacity.js'
import { createTokenTollServer } from './server.js'
import type { ModelPricing, TokenTollConfig } from './config.js'

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

function baseConfig(overrides: Partial<TokenTollConfig> = {}): TokenTollConfig {
  return {
    upstream: 'http://localhost:11434',
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
    verbose: false,
    logFormat: 'pretty',
    ...overrides,
  }
}

describe('Security: path allowlisting in proxy handler', () => {
  let upstreamServer: ReturnType<typeof serve>
  let upstreamUrl: string

  beforeEach(async () => {
    const app = new Hono()
    app.all('*', (c) => c.json({ data: 'sensitive-internal-endpoint' }))
    await new Promise<void>((resolve) => {
      upstreamServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
        upstreamUrl = `http://localhost:${info.port}`
        resolve()
      })
    })
  })

  afterEach(() => { upstreamServer?.close() })

  it('allows /v1/chat/completions', async () => {
    const handler = createProxyHandler(makeDeps({ upstream: upstreamUrl }))
    const req = new Request(`http://test/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })
    const res = await handler(req, undefined)
    // Should reach upstream (200) or get upstream-level error, not 404
    expect(res.status).not.toBe(404)
  })

  it('allows /v1/completions', async () => {
    const handler = createProxyHandler(makeDeps({ upstream: upstreamUrl }))
    const req = new Request(`http://test/v1/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', prompt: 'hi' }),
    })
    const res = await handler(req, undefined)
    expect(res.status).not.toBe(404)
  })

  it('allows /v1/embeddings', async () => {
    const handler = createProxyHandler(makeDeps({ upstream: upstreamUrl }))
    const req = new Request(`http://test/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', input: 'hi' }),
    })
    const res = await handler(req, undefined)
    expect(res.status).not.toBe(404)
  })

  it('rejects path traversal attempt', async () => {
    const handler = createProxyHandler(makeDeps({ upstream: upstreamUrl }))
    const req = new Request(`http://test/v1/chat/completions/../../../etc/passwd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })
    const res = await handler(req, undefined)
    expect(res.status).toBe(404)
  })

  it('rejects unknown /v1 subpaths', async () => {
    const handler = createProxyHandler(makeDeps({ upstream: upstreamUrl }))
    const req = new Request(`http://test/v1/internal/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })
    const res = await handler(req, undefined)
    expect(res.status).toBe(404)
  })

  it('rejects request to root path', async () => {
    const handler = createProxyHandler(makeDeps({ upstream: upstreamUrl }))
    const req = new Request(`http://test/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })
    const res = await handler(req, undefined)
    expect(res.status).toBe(404)
  })
})

describe('Security: security headers', () => {
  it('includes security headers on all responses', async () => {
    const { app } = createTokenTollServer(baseConfig())

    const res = await app.request('/health')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('X-Download-Options')).toBe('noopen')
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=')
  })

  it('includes security headers on discovery endpoints', async () => {
    const { app } = createTokenTollServer(baseConfig())

    const res = await app.request('/.well-known/l402')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
  })

  it('includes security headers on error responses', async () => {
    const { app } = createTokenTollServer(baseConfig())

    // Hit an endpoint that doesn't exist
    const res = await app.request('/nonexistent')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})

describe('Security: /v1/models response sanitisation', () => {
  let upstreamServer: ReturnType<typeof serve>
  let upstreamUrl: string

  afterEach(() => { upstreamServer?.close() })

  it('strips unexpected fields from upstream models response', async () => {
    const app = new Hono()
    app.get('/v1/models', (c) => {
      return c.json({
        data: [
          { id: 'llama3', object: 'model', owned_by: 'internal-team', internal_path: '/mnt/models/llama3' },
          { id: 'mistral', object: 'model', secret_field: 'should-not-leak' },
        ],
        extra_metadata: { deployment_id: 'prod-12345' },
      })
    })
    await new Promise<void>((resolve) => {
      upstreamServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
        upstreamUrl = `http://localhost:${info.port}`
        resolve()
      })
    })

    const { app: tollApp } = createTokenTollServer(baseConfig({ upstream: upstreamUrl }))
    const res = await tollApp.request('/v1/models')
    const body = await res.json() as Record<string, unknown>

    const bodyStr = JSON.stringify(body)
    expect(bodyStr).not.toContain('internal-team')
    expect(bodyStr).not.toContain('/mnt/models/')
    expect(bodyStr).not.toContain('secret_field')
    expect(bodyStr).not.toContain('should-not-leak')
    expect(bodyStr).not.toContain('deployment_id')
    expect(bodyStr).not.toContain('prod-12345')

    // Should still contain model IDs
    expect(bodyStr).toContain('llama3')
    expect(bodyStr).toContain('mistral')
  })

  it('handles malformed upstream models response', async () => {
    const app = new Hono()
    app.get('/v1/models', (c) => {
      return c.json({ not_data: 'broken' })
    })
    await new Promise<void>((resolve) => {
      upstreamServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
        upstreamUrl = `http://localhost:${info.port}`
        resolve()
      })
    })

    const { app: tollApp } = createTokenTollServer(baseConfig({ upstream: upstreamUrl }))
    const res = await tollApp.request('/v1/models')
    const body = await res.json() as Record<string, unknown>

    expect(body).toHaveProperty('data')
    expect(Array.isArray((body as any).data)).toBe(true)
    expect((body as any).data).toHaveLength(0)
  })

  it('filters out entries without string id', async () => {
    const app = new Hono()
    app.get('/v1/models', (c) => {
      return c.json({
        data: [
          { id: 'valid-model', object: 'model' },
          { object: 'model' }, // missing id
          { id: 123, object: 'model' }, // non-string id
          null,
          'not-an-object',
        ],
      })
    })
    await new Promise<void>((resolve) => {
      upstreamServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
        upstreamUrl = `http://localhost:${info.port}`
        resolve()
      })
    })

    const { app: tollApp } = createTokenTollServer(baseConfig({ upstream: upstreamUrl }))
    const res = await tollApp.request('/v1/models')
    const body = await res.json() as any

    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe('valid-model')
  })
})

describe('Security: X402 facilitator response validation', () => {
  it('handles facilitator returning unexpected shape', async () => {
    // This is a unit test of the validation logic — import directly
    const { createHttpFacilitator } = await import('./x402/facilitator.js')

    let facilitatorServer: ReturnType<typeof serve>
    const app = new Hono()
    app.post('*', (c) => {
      // Return something that doesn't match X402VerifyResult
      return c.json({ unexpected: 'shape', valid: 'not-a-boolean' })
    })

    let facilitatorUrl: string
    await new Promise<void>((resolve) => {
      facilitatorServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
        facilitatorUrl = `http://localhost:${info.port}`
        resolve()
      })
    })

    try {
      const facilitator = createHttpFacilitator({ facilitatorUrl: facilitatorUrl! })
      const result = await facilitator.verify({} as any)
      // Should not trust non-boolean 'valid'
      expect(result.valid).toBe(false)
      expect(result.txHash).toBe('')
      expect(result.amount).toBe(0)
      expect(result.sender).toBe('')
    } finally {
      facilitatorServer!.close()
    }
  })

  it('handles facilitator returning valid response', async () => {
    const { createHttpFacilitator } = await import('./x402/facilitator.js')

    let facilitatorServer: ReturnType<typeof serve>
    const app = new Hono()
    app.post('*', (c) => {
      return c.json({ valid: true, txHash: 'abc123', amount: 100, sender: '0xdead' })
    })

    let facilitatorUrl: string
    await new Promise<void>((resolve) => {
      facilitatorServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
        facilitatorUrl = `http://localhost:${info.port}`
        resolve()
      })
    })

    try {
      const facilitator = createHttpFacilitator({ facilitatorUrl: facilitatorUrl! })
      const result = await facilitator.verify({} as any)
      expect(result.valid).toBe(true)
      expect(result.txHash).toBe('abc123')
      expect(result.amount).toBe(100)
      expect(result.sender).toBe('0xdead')
    } finally {
      facilitatorServer!.close()
    }
  })
})
