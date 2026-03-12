import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createTokenTollServer } from '../../src/server.js'

function mockUpstream() {
  const app = new Hono()
  app.post('/v1/chat/completions', async (c) => {
    const body = await c.req.json()
    if (body.stream) {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'))
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"!"}}]}\n\n'))
          controller.enqueue(encoder.encode('data: {"choices":[],"usage":{"total_tokens":20}}\n\n'))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    }
    return c.json({
      choices: [{ message: { role: 'assistant', content: 'Hello!' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })
  })
  app.get('/v1/models', (c) => c.json({ data: [{ id: 'llama3' }] }))
  return app
}

const rootKey = 'a'.repeat(64)

const baseConfig = {
  port: 0,
  rootKey,
  rootKeyGenerated: false,
  storage: 'memory' as const,
  dbPath: '',
  pricing: { default: 1, models: {} },
  freeTier: { requestsPerDay: 0 },
  capacity: { maxConcurrent: 0 },
  tiers: [],
  trustProxy: false,
  estimatedCostSats: 10,
  maxBodySize: 10 * 1024 * 1024,
  authMode: 'lightning' as const,
  allowlist: [],
  flatPricing: false,
  price: 0,
  tunnel: false,
}

describe('E2E: token-toll', () => {
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

  describe('E2E: token-toll inference', () => {
    it('returns 402 for unauthenticated inference request', async () => {
      const { app } = createTokenTollServer({
        ...baseConfig,
        upstream: upstreamUrl,
        pricing: { default: 1, models: { llama3: 2 } },
        capacity: { maxConcurrent: 2 },
      })

      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] }),
      })
      expect(res.status).toBe(402)
    })

    it('free tier: first request passes, subsequent requires payment', async () => {
      const { app } = createTokenTollServer({
        ...baseConfig,
        upstream: upstreamUrl,
        freeTier: { requestsPerDay: 1 },
      })

      // First request - free tier
      const res1 = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3', messages: [] }),
      })
      expect(res1.status).toBe(200)

      // Second request - should require payment
      const res2 = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3', messages: [] }),
      })
      expect(res2.status).toBe(402)
    })

    it('discoverability endpoints all return 200', async () => {
      const { app } = createTokenTollServer({
        ...baseConfig,
        upstream: upstreamUrl,
      })

      const endpoints = ['/.well-known/l402', '/llms.txt', '/openapi.json', '/health', '/v1/models']
      for (const endpoint of endpoints) {
        const res = await app.request(endpoint)
        expect(res.status, `${endpoint} should return 200`).toBe(200)
      }
    })

    it('create-invoice endpoint works', async () => {
      const { app } = createTokenTollServer({
        ...baseConfig,
        upstream: upstreamUrl,
      })

      const res = await app.request('/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      // Without a Lightning backend, create-invoice should return an error or a cashu-only response
      // The important thing is it doesn't crash (500)
      expect(res.status).not.toBe(500)
    })
  })

  describe('E2E: open auth mode', () => {
    it('allows unauthenticated requests in open mode', async () => {
      const { app } = createTokenTollServer({
        ...baseConfig,
        upstream: upstreamUrl,
        authMode: 'open',
        flatPricing: true,
        price: 1,
      })

      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] }),
      })
      expect(res.status).toBe(200)
    })
  })

  describe('E2E: allowlist auth mode', () => {
    it('rejects unauthorised requests', async () => {
      const { app } = createTokenTollServer({
        ...baseConfig,
        upstream: upstreamUrl,
        authMode: 'allowlist',
        allowlist: ['secret-abc'],
        flatPricing: true,
        price: 1,
      })

      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3', messages: [] }),
      })
      expect(res.status).toBe(403)
    })

    it('allows authorised requests', async () => {
      const { app } = createTokenTollServer({
        ...baseConfig,
        upstream: upstreamUrl,
        authMode: 'allowlist',
        allowlist: ['secret-abc'],
        flatPricing: true,
        price: 1,
      })

      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer secret-abc',
        },
        body: JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] }),
      })
      expect(res.status).toBe(200)
    })
  })

  describe('E2E: flat pricing mode', () => {
    it('completes request without reconciliation errors in flat pricing mode', async () => {
      const { app } = createTokenTollServer({
        ...baseConfig,
        upstream: upstreamUrl,
        authMode: 'open',
        flatPricing: true,
        price: 2,
      })

      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.choices).toBeDefined()
    })
  })
})
