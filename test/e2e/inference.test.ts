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

describe('E2E: token-toll inference', () => {
  const rootKey = 'a'.repeat(64)
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

  it('returns 402 for unauthenticated inference request', async () => {
    const { app } = createTokenTollServer({
      upstream: upstreamUrl,
      port: 0,
      rootKey,
      rootKeyGenerated: false,
      storage: 'memory',
      dbPath: '',
      pricing: { default: 1, models: { llama3: 2 } },
      freeTier: { requestsPerDay: 0 },
      capacity: { maxConcurrent: 2 },
      tiers: [],
      trustProxy: false,
      estimatedCostSats: 10,
      maxBodySize: 10 * 1024 * 1024,
      authMode: 'lightning',
      allowlist: [],
      flatPricing: false,
      price: 0,
      tunnel: false,
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
      upstream: upstreamUrl,
      port: 0,
      rootKey,
      rootKeyGenerated: false,
      storage: 'memory',
      dbPath: '',
      pricing: { default: 1, models: {} },
      freeTier: { requestsPerDay: 1 },
      capacity: { maxConcurrent: 0 },
      tiers: [],
      trustProxy: false,
      estimatedCostSats: 10,
      maxBodySize: 10 * 1024 * 1024,
      authMode: 'lightning',
      allowlist: [],
      flatPricing: false,
      price: 0,
      tunnel: false,
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
      upstream: upstreamUrl,
      port: 0,
      rootKey,
      rootKeyGenerated: false,
      storage: 'memory',
      dbPath: '',
      pricing: { default: 1, models: {} },
      freeTier: { requestsPerDay: 0 },
      capacity: { maxConcurrent: 0 },
      tiers: [],
      trustProxy: false,
      estimatedCostSats: 10,
      maxBodySize: 10 * 1024 * 1024,
      authMode: 'lightning',
      allowlist: [],
      flatPricing: false,
      price: 0,
      tunnel: false,
    })

    const endpoints = ['/.well-known/l402', '/llms.txt', '/openapi.json', '/health', '/v1/models']
    for (const endpoint of endpoints) {
      const res = await app.request(endpoint)
      expect(res.status, `${endpoint} should return 200`).toBe(200)
    }
  })

  it('create-invoice endpoint works', async () => {
    const { app } = createTokenTollServer({
      upstream: upstreamUrl,
      port: 0,
      rootKey,
      rootKeyGenerated: false,
      storage: 'memory',
      dbPath: '',
      pricing: { default: 1, models: {} },
      freeTier: { requestsPerDay: 0 },
      capacity: { maxConcurrent: 0 },
      tiers: [],
      trustProxy: false,
      estimatedCostSats: 10,
      maxBodySize: 10 * 1024 * 1024,
      authMode: 'lightning',
      allowlist: [],
      flatPricing: false,
      price: 0,
      tunnel: false,
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
