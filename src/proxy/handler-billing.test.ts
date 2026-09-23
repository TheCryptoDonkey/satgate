import { describe, it, expect, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createProxyHandler, type ProxyDeps } from './handler.js'
import { CapacityTracker } from './capacity.js'

/** Upstream that records every request body and replies with a fixed SSE script. */
async function startUpstream(sse: string[] = ['data: [DONE]\n\n']) {
  const bodies: Record<string, unknown>[] = []
  const app = new Hono()
  app.post('/v1/chat/completions', async (c) => {
    const body = await c.req.json()
    bodies.push(body)
    if (body.stream) {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of sse) controller.enqueue(encoder.encode(chunk))
          controller.close()
        },
      })
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    }
    return c.json({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } })
  })
  let server: ReturnType<typeof serve> | undefined
  const url = await new Promise<string>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => resolve(`http://localhost:${info.port}`))
  })
  return { url, bodies, close: () => server?.close() }
}

let upstream: Awaited<ReturnType<typeof startUpstream>> | undefined
afterEach(() => upstream?.close())

function deps(url: string, overrides: Partial<ProxyDeps> = {}): ProxyDeps {
  return {
    upstream: url,
    pricing: { default: 1, models: {} },
    capacity: new CapacityTracker(0),
    reconcile: vi.fn().mockReturnValue({ adjusted: true, newBalance: 0, delta: 0 }),
    maxBodySize: 10 * 1024 * 1024,
    ...overrides,
  }
}

function chat(url: string, body: Record<string, unknown>) {
  return new Request(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('stream usage reporting', () => {
  it('forces include_usage even when the client turns it off', async () => {
    upstream = await startUpstream()
    const handler = createProxyHandler(deps(upstream.url))
    const res = await handler(chat(upstream.url, {
      model: 'm', messages: [], stream: true,
      stream_options: { include_usage: false, other: 'kept' },
    }), 'a'.repeat(64))
    await res.text()
    expect(upstream.bodies[0].stream_options).toEqual({ include_usage: true, other: 'kept' })
  })

  it('forces include_usage when stream_options is not an object', async () => {
    upstream = await startUpstream()
    const handler = createProxyHandler(deps(upstream.url))
    const res = await handler(chat(upstream.url, { model: 'm', messages: [], stream: true, stream_options: 'nope' }), 'a'.repeat(64))
    await res.text()
    expect(upstream.bodies[0].stream_options).toEqual({ include_usage: true })
  })
})
