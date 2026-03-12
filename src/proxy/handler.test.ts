import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createProxyHandler, type ProxyDeps } from './handler.js'
import { CapacityTracker } from './capacity.js'
import type { ModelPricing } from '../config.js'

const pricing: ModelPricing = { default: 1, models: { llama3: 2 } }

function mockUpstream() {
  const app = new Hono()

  app.post('/v1/chat/completions', async (c) => {
    const body = await c.req.json()
    if (body.stream) {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'))
          controller.enqueue(encoder.encode('data: {"choices":[],"usage":{"total_tokens":15}}\n\n'))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }
    return c.json({
      choices: [{ message: { role: 'assistant', content: 'Hello!' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })
  })

  app.get('/v1/models', (c) => {
    return c.json({
      data: [
        { id: 'llama3', object: 'model' },
        { id: 'mistral', object: 'model' },
      ],
    })
  })

  return app
}

describe('AI proxy handler', () => {
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

  it('proxies non-streaming request and returns token cost', async () => {
    const reconcile = vi.fn().mockReturnValue({ adjusted: true, newBalance: 990, delta: 8 })
    const deps: ProxyDeps = {
      upstream: upstreamUrl,
      pricing,
      capacity: new CapacityTracker(0),
      reconcile,
      maxBodySize: 10 * 1024 * 1024,
    }

    const handler = createProxyHandler(deps)
    const req = new Request(`${upstreamUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'Hi' }] }),
    })

    const res = await handler(req, 'test-payment-hash')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.usage.total_tokens).toBe(15)
    expect(reconcile).toHaveBeenCalledWith('test-payment-hash', 1) // ceil(15 * 2 / 1000) = 1
  })

  it('proxies streaming request', async () => {
    const reconcile = vi.fn().mockReturnValue({ adjusted: true, newBalance: 990, delta: 8 })
    const deps: ProxyDeps = {
      upstream: upstreamUrl,
      pricing,
      capacity: new CapacityTracker(0),
      reconcile,
      maxBodySize: 10 * 1024 * 1024,
    }

    const handler = createProxyHandler(deps)
    const req = new Request(`${upstreamUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'Hi' }], stream: true }),
    })

    const res = await handler(req, 'test-payment-hash')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    // Consume the stream
    const text = await res.text()
    expect(text).toContain('Hi')

    // Wait for reconcile (happens in flush, which is async after stream consumption)
    await new Promise((r) => setTimeout(r, 50))
    expect(reconcile).toHaveBeenCalledWith('test-payment-hash', 1) // ceil(15 * 2 / 1000) = 1
  })

  it('returns 503 when at capacity', async () => {
    const deps: ProxyDeps = {
      upstream: upstreamUrl,
      pricing,
      capacity: new CapacityTracker(1),
      reconcile: vi.fn(),
      maxBodySize: 10 * 1024 * 1024,
    }

    const handler = createProxyHandler(deps)
    deps.capacity.tryAcquire() // fill capacity

    const req = new Request(`${upstreamUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3', messages: [] }),
    })

    const res = await handler(req, 'test-payment-hash')
    expect(res.status).toBe(503)
  })

  it('reconciles with 0 on upstream failure', async () => {
    const reconcile = vi.fn().mockReturnValue({ adjusted: true, newBalance: 1000, delta: 10 })
    const deps: ProxyDeps = {
      upstream: 'http://localhost:1', // unreachable
      pricing,
      capacity: new CapacityTracker(0),
      reconcile,
      maxBodySize: 10 * 1024 * 1024,
    }

    const handler = createProxyHandler(deps)
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3', messages: [] }),
    })

    const res = await handler(req, 'test-payment-hash')
    expect(res.status).toBe(502)
    expect(reconcile).toHaveBeenCalledWith('test-payment-hash', 0)
  })

  it('skips reconciliation when flatPricing is true (non-streaming)', async () => {
    let reconcileCalled = false
    const capacity = new CapacityTracker(0)
    const handler = createProxyHandler({
      upstream: upstreamUrl,
      pricing: { default: 1, models: {} },
      capacity,
      reconcile: () => { reconcileCalled = true; return { adjusted: false, newBalance: 0, delta: 0 } },
      maxBodySize: 10 * 1024 * 1024,
      flatPricing: true,
    })

    const req = new Request(`http://test/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })
    await handler(req, 'a'.repeat(64))

    expect(reconcileCalled).toBe(false)
  })

  it('rejects request with missing Content-Type', async () => {
    const deps: ProxyDeps = {
      upstream: upstreamUrl,
      pricing,
      capacity: new CapacityTracker(0),
      reconcile: vi.fn(),
      maxBodySize: 10 * 1024 * 1024,
    }

    const handler = createProxyHandler(deps)
    const req = new Request(`${upstreamUrl}/v1/chat/completions`, {
      method: 'POST',
      body: JSON.stringify({ model: 'llama3', messages: [] }),
    })

    const res = await handler(req, undefined)
    expect(res.status).toBe(415)
    const body = await res.json()
    expect(body.error).toContain('Content-Type')
  })

  it('rejects request with wrong Content-Type', async () => {
    const deps: ProxyDeps = {
      upstream: upstreamUrl,
      pricing,
      capacity: new CapacityTracker(0),
      reconcile: vi.fn(),
      maxBodySize: 10 * 1024 * 1024,
    }

    const handler = createProxyHandler(deps)
    const req = new Request(`${upstreamUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ model: 'llama3', messages: [] }),
    })

    const res = await handler(req, undefined)
    expect(res.status).toBe(415)
  })

  it('rejects request body exceeding maxBodySize', async () => {
    const deps: ProxyDeps = {
      upstream: upstreamUrl,
      pricing,
      capacity: new CapacityTracker(0),
      reconcile: vi.fn(),
      maxBodySize: 100, // very small
    }

    const handler = createProxyHandler(deps)
    const largeBody = JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'x'.repeat(200) }] })
    const req = new Request(`${upstreamUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: largeBody,
    })

    const res = await handler(req, undefined)
    expect(res.status).toBe(413)
  })

  it('rejects JSON array body', async () => {
    const deps: ProxyDeps = {
      upstream: upstreamUrl,
      pricing,
      capacity: new CapacityTracker(0),
      reconcile: vi.fn(),
      maxBodySize: 10 * 1024 * 1024,
    }

    const handler = createProxyHandler(deps)
    const req = new Request(`${upstreamUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ model: 'llama3' }]),
    })

    const res = await handler(req, undefined)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('JSON object')
  })

  it('rejects JSON null body', async () => {
    const deps: ProxyDeps = {
      upstream: upstreamUrl,
      pricing,
      capacity: new CapacityTracker(0),
      reconcile: vi.fn(),
      maxBodySize: 10 * 1024 * 1024,
    }

    const handler = createProxyHandler(deps)
    const req = new Request(`${upstreamUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    })

    const res = await handler(req, undefined)
    expect(res.status).toBe(400)
  })

  it('rejects JSON string body', async () => {
    const deps: ProxyDeps = {
      upstream: upstreamUrl,
      pricing,
      capacity: new CapacityTracker(0),
      reconcile: vi.fn(),
      maxBodySize: 10 * 1024 * 1024,
    }

    const handler = createProxyHandler(deps)
    const req = new Request(`${upstreamUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '"hello"',
    })

    const res = await handler(req, undefined)
    expect(res.status).toBe(400)
  })

  it('skips reconciliation when flatPricing is true (streaming)', async () => {
    let reconcileCalled = false
    const capacity = new CapacityTracker(0)
    const handler = createProxyHandler({
      upstream: upstreamUrl,
      pricing: { default: 1, models: {} },
      capacity,
      reconcile: () => { reconcileCalled = true; return { adjusted: false, newBalance: 0, delta: 0 } },
      maxBodySize: 10 * 1024 * 1024,
      flatPricing: true,
    })

    const req = new Request(`http://test/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [], stream: true }),
    })
    const res = await handler(req, 'a'.repeat(64))

    // Consume stream to trigger onComplete
    if (res.body) {
      const reader = res.body.getReader()
      while (!(await reader.read()).done) { /* drain */ }
    }

    expect(reconcileCalled).toBe(false)
  })
})
