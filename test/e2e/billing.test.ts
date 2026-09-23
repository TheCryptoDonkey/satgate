import { describe, it, expect, afterEach } from 'vitest'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createTokenTollServer } from '../../src/server.js'
import type { TokenTollConfig } from '../../src/config.js'
import { createPreimageBackend, buyL402Credential } from './helpers/l402-wallet.js'

/**
 * Upstream that reports usage taken from the request: a user message of
 * "tokens=N" is answered with N completion tokens. The first `hold`
 * requests wait at a barrier until all of them have arrived, so they overlap.
 */
async function startUpstream(opts: { hold?: number } = {}) {
  const bodies: Record<string, any>[] = []
  let waiting: Array<() => void> = []
  let released = false
  const app = new Hono()
  const handler = async (c: any) => {
    const body = await c.req.json()
    bodies.push(body)
    if (opts.hold && opts.hold > 1 && !released) {
      await new Promise<void>((resolve) => {
        waiting.push(resolve)
        if (waiting.length >= opts.hold!) {
          released = true
          for (const r of waiting) r()
          waiting = []
        }
      })
    }
    const content = String(body.messages?.[0]?.content ?? body.prompt ?? '')
    const match = /tokens=(\d+)/.exec(content)
    const completion = match ? Number(match[1]) : 1
    return c.json({
      model: body.model,
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 0, completion_tokens: completion, total_tokens: completion },
    })
  }
  app.post('/v1/chat/completions', handler)
  app.post('/v1/completions', handler)
  let server: ReturnType<typeof serve> | undefined
  const url = await new Promise<string>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => resolve(`http://localhost:${info.port}`))
  })
  return { url, bodies, close: () => server?.close() }
}

export function paidConfig(upstream: string, overrides: Partial<TokenTollConfig> = {}): TokenTollConfig {
  return {
    upstream,
    port: 0,
    rootKey: 'b'.repeat(64),
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
    authMode: 'lightning',
    lightning: 'phoenixd',
    allowlist: [],
    flatPricing: false,
    price: 1,
    tunnel: false,
    verbose: false,
    logFormat: 'pretty',
    serviceName: 'satgate',
    sessionIntent: false,
    maxSessionDepositSats: 100_000,
    maxSessionDurationMs: 86_400_000,
    announce: false,
    announceRelays: [],
    announceKey: '',
    ...overrides,
  } as TokenTollConfig
}

function chat(auth: string, content: string, extra: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content }], ...extra }),
  }
}

let upstream: Awaited<ReturnType<typeof startUpstream>> | undefined
afterEach(() => upstream?.close())

describe('per-token billing on one credential', () => {
  it('settles concurrent requests independently', async () => {
    upstream = await startUpstream({ hold: 2 })
    const { backend, preimages } = createPreimageBackend()
    const { app } = createTokenTollServer(paidConfig(upstream.url, { backend }))
    const auth = await buyL402Credential(app, preimages)

    // 1000 sats of credit. Two overlapping requests cost 1 and 3 sats.
    const [a, b] = await Promise.all([
      app.request('/v1/chat/completions', chat(auth, 'tokens=1000')),
      app.request('/v1/chat/completions', chat(auth, 'tokens=3000')),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)

    // A third request shows the balance after its own 10-sat hold
    const probe = await app.request('/v1/chat/completions', chat(auth, 'tokens=1'))
    expect(probe.status).toBe(200)
    expect(probe.headers.get('X-Credit-Balance')).toBe(String(1000 - 1 - 3 - 10))
  })

  it('refunds the hold when the request body is not valid JSON', async () => {
    upstream = await startUpstream()
    const { backend, preimages } = createPreimageBackend()
    const { app } = createTokenTollServer(paidConfig(upstream.url, { backend }))
    const auth = await buyL402Credential(app, preimages)

    const bad = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: '{not json',
    })
    expect(bad.status).toBe(400)

    const probe = await app.request('/v1/chat/completions', chat(auth, 'tokens=1'))
    expect(probe.headers.get('X-Credit-Balance')).toBe(String(1000 - 10))
  })
})

describe('model names', () => {
  it('refuses a model alias outside the served list without charging', async () => {
    upstream = await startUpstream()
    const { backend, preimages } = createPreimageBackend()
    const { app } = createTokenTollServer(paidConfig(upstream.url, {
      backend,
      models: ['gemma3:4b'],
      pricing: { default: 1, models: { 'gemma3:4b': 50 } },
    }))
    const auth = await buyL402Credential(app, preimages)

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ model: 'registry.ollama.ai/library/gemma3:4b', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(400)
    expect(upstream.bodies).toHaveLength(0)

    const probe = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ model: 'gemma3:4b', messages: [{ role: 'user', content: 'tokens=1' }] }),
    })
    expect(probe.status).toBe(200)
    expect(probe.headers.get('X-Credit-Balance')).toBe(String(1000 - 10))
  })
})
