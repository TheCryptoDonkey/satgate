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

  it('rejects oversized request body', async () => {
    const deps: ProxyDeps = {
      upstream: upstreamUrl,
      pricing,
      capacity: new CapacityTracker(0),
      reconcile: vi.fn(),
      maxBodySize: 100, // 100 bytes
    }

    const handler = createProxyHandler(deps)
    const largeBody = JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'x'.repeat(200) }] })
    const req = new Request(`${upstreamUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(largeBody.length) },
      body: largeBody,
    })

    const res = await handler(req, undefined)
    expect(res.status).toBe(413)
  })

  it('rejects invalid JSON body', async () => {
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
      body: 'not-json',
    })

    const res = await handler(req, undefined)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid JSON body')
  })

  it('times out on slow upstream', async () => {
    // Create a slow upstream that never responds
    const slowApp = new Hono()
    slowApp.post('/v1/chat/completions', async () => {
      await new Promise((r) => setTimeout(r, 10_000))
      return new Response('too late')
    })

    let slowServer: ReturnType<typeof serve>
    let slowUrl: string
    await new Promise<void>((resolve) => {
      slowServer = serve({ fetch: slowApp.fetch, port: 0 }, (info) => {
        slowUrl = `http://localhost:${info.port}`
        resolve()
      })
    })

    try {
      const reconcile = vi.fn().mockReturnValue({ adjusted: true, newBalance: 1000, delta: 10 })
      const handler = createProxyHandler({
        upstream: slowUrl!,
        pricing,
        capacity: new CapacityTracker(0),
        reconcile,
        maxBodySize: 10 * 1024 * 1024,
        upstreamTimeoutMs: 100, // 100ms timeout
      })

      const req = new Request(`http://test/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'test', messages: [] }),
      })

      const res = await handler(req, 'test-hash')
      expect(res.status).toBe(502)
      expect(reconcile).toHaveBeenCalledWith('test-hash', 0)
    } finally {
      slowServer!.close()
    }
  })

  it('caps upstream error response size', async () => {
    const errorApp = new Hono()
    errorApp.post('/v1/chat/completions', () => {
      return new Response('x'.repeat(10_000_000), { status: 500 })
    })

    let errorServer: ReturnType<typeof serve>
    let errorUrl: string
    await new Promise<void>((resolve) => {
      errorServer = serve({ fetch: errorApp.fetch, port: 0 }, (info) => {
        errorUrl = `http://localhost:${info.port}`
        resolve()
      })
    })

    try {
      const handler = createProxyHandler({
        upstream: errorUrl!,
        pricing,
        capacity: new CapacityTracker(0),
        reconcile: vi.fn().mockReturnValue({ adjusted: false, newBalance: 0, delta: 0 }),
        maxBodySize: 10 * 1024 * 1024,
      })

      const req = new Request(`http://test/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'test', messages: [] }),
      })

      const res = await handler(req, undefined)
      expect(res.status).toBe(500)
      const body = await res.text()
      // Should be capped at 5 MiB (MAX_RESPONSE_SIZE)
      expect(body.length).toBeLessThanOrEqual(5 * 1024 * 1024)
    } finally {
      errorServer!.close()
    }
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
