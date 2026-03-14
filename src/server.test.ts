import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { serve } from '@hono/node-server'
import { createTokenTollServer } from './server.js'
import { Hono } from 'hono'

function mockUpstream() {
  const app = new Hono()
  app.post('/v1/chat/completions', (c) => {
    return c.json({
      choices: [{ message: { role: 'assistant', content: 'Hello!' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })
  })
  app.get('/v1/models', (c) => {
    return c.json({ data: [{ id: 'llama3', object: 'model' }] })
  })
  return app
}

describe('createTokenTollServer', () => {
  let upstreamServer: ReturnType<typeof serve>
  let upstreamUrl: string

  beforeEach(async () => {
    const upstream = mockUpstream()
    await new Promise<void>((resolve) => {
      upstreamServer = serve({ fetch: upstream.fetch, port: 0 }, (info) => {
        upstreamUrl = `http://localhost:${info.port}`
        resolve()
      })
    })
  })

  afterEach(() => {
    upstreamServer?.close()
  })

  it('creates a Hono app with all routes', async () => {
    const { app } = createTokenTollServer({
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
      authMode: 'lightning' as const,
      allowlist: [],
      flatPricing: false,
      price: 1,
      tunnel: false,
    })

    // Health check
    const healthRes = await app.request('/health')
    expect(healthRes.status).toBe(200)
    const health = await healthRes.json()
    expect(health.status).toBe('ok')

    // Discoverability
    const wellKnownRes = await app.request('/.well-known/l402')
    expect(wellKnownRes.status).toBe(200)

    const llmsTxtRes = await app.request('/llms.txt')
    expect(llmsTxtRes.status).toBe(200)

    const openapiRes = await app.request('/openapi.json')
    expect(openapiRes.status).toBe(200)

    // /v1/models passes through without auth
    const modelsRes = await app.request('/v1/models')
    expect(modelsRes.status).toBe(200)

    // /v1/chat/completions requires auth
    const chatRes = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3', messages: [] }),
    })
    expect(chatRes.status).toBe(402)
  })

  it('serves landing page at GET /', async () => {
    const { app } = createTokenTollServer({
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
      authMode: 'lightning' as const,
      allowlist: [],
      flatPricing: false,
      price: 1,
      tunnel: false,
    })

    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('satgate')
  })

  it('passes lightning backend to toll-booth when configured', async () => {
    const mockBackend = {
      createInvoice: async () => ({ bolt11: 'lnbc...', paymentHash: 'a'.repeat(64) }),
      checkInvoice: async () => ({ paid: false }),
    }

    const { app } = createTokenTollServer({
      upstream: upstreamUrl,
      port: 0,
      rootKey: 'a'.repeat(64),
      rootKeyGenerated: false,
      storage: 'memory',
      dbPath: '',
      pricing: { default: 1, models: {} },
      freeTier: { creditsPerDay: 0 },
      capacity: { maxConcurrent: 0 },
      tiers: [{ amountSats: 1000, creditSats: 1000, label: '1k sats' }],
      trustProxy: false,
      estimatedCostSats: 10,
      maxBodySize: 10 * 1024 * 1024,
      authMode: 'lightning',
      allowlist: [],
      flatPricing: true,
      price: 1,
      tunnel: false,
      backend: mockBackend,
    })

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3', messages: [] }),
    })
    expect(res.status).toBe(402)
  })
})
