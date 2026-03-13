import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createTokenTollServer } from '../../src/server.js'
import { createMockLightning, createMockPayInvoice } from './helpers/mock-lightning.js'
import { InMemoryCredentialStore } from './helpers/mock-credential-store.js'

// l402-mcp imports — NO .js suffix (wildcard subpath exports)
import { handleDiscover } from 'l402-mcp/tools/discover'
import { handleFetch } from 'l402-mcp/tools/fetch'
import { ChallengeCache } from 'l402-mcp/l402/challenge-cache'
import { SpendTracker } from 'l402-mcp/spend-tracker'
import { decodeBolt11 } from 'l402-mcp/l402/bolt11'
import { parseL402Challenge } from 'l402-mcp/l402/parse'
import { detectServer } from 'l402-mcp/l402/detect'

import { memoryStorage } from '@thecryptodonkey/toll-booth/storage/memory'

// Mock upstream (Ollama stand-in)
function mockUpstream() {
  const app = new Hono()
  app.post('/v1/chat/completions', async (c) => {
    const body = await c.req.json()
    if (body.stream) {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'))
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" world"}}]}\n\n'))
          controller.enqueue(encoder.encode('data: {"choices":[],"usage":{"total_tokens":20}}\n\n'))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    }
    return c.json({
      choices: [{ message: { role: 'assistant', content: 'Hello from token-toll!' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })
  })
  app.get('/v1/models', (c) => c.json({ data: [{ id: 'test-model' }] }))
  return app
}

const rootKey = 'a'.repeat(64)

describe('E2E: l402-mcp → token-toll', () => {
  let upstreamServer: ReturnType<typeof serve>
  let tokenTollServer: ReturnType<typeof serve>
  let baseUrl: string
  let preimageMap: Map<string, string>

  beforeAll(async () => {
    // 1. Start mock upstream
    const upstream = mockUpstream()
    const upstreamUrl = await new Promise<string>((resolve) => {
      upstreamServer = serve({ fetch: upstream.fetch, port: 0 }, (info) => {
        resolve(`http://localhost:${info.port}`)
      })
    })

    // 2. Create token-toll with mock Lightning
    const storage = memoryStorage()
    const mockLn = createMockLightning(storage)
    preimageMap = mockLn.preimageMap

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
      tiers: [
        { amountSats: 100, creditSats: 100, label: '100 sats' },
      ],
      trustProxy: false,
      estimatedCostSats: 10,
      maxBodySize: 10 * 1024 * 1024,
      authMode: 'lightning',
      allowlist: [],
      flatPricing: false,
      price: 0,
      tunnel: false,
      models: ['test-model'],
      backend: mockLn.backend,
    })

    // 3. Start token-toll HTTP server
    baseUrl = await new Promise<string>((resolve) => {
      tokenTollServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
        resolve(`http://localhost:${info.port}`)
      })
    })
  })

  afterAll(() => {
    tokenTollServer?.close()
    upstreamServer?.close()
  })

  // Scenario 1: Discovery
  it('discovers pricing via handleDiscover', async () => {
    const cache = new ChallengeCache()

    const result = await handleDiscover(
      { url: `${baseUrl}/v1/chat/completions`, method: 'POST' },
      { fetchFn: fetch, cache, decodeBolt11 },
    )

    expect(result.isError).toBeUndefined()
    const data = JSON.parse(result.content[0].text)

    expect(data.url).toBe(`${baseUrl}/v1/chat/completions`)
    expect(data.costSats).toBeGreaterThan(0)
    expect(data.paymentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(data.invoice).toMatch(/^lnbc/)
    expect(data.macaroon).toBeDefined()

    // toll-booth body nests fields under `l402`, so detectServer sees 'generic'
    // unless `x-powered-by: toll-booth` is set. Verify the response still has
    // the core discovery fields regardless.
    expect(data.server).toBeUndefined()

    // Challenge should be cached
    expect(cache.size).toBe(1)
  })

  // Scenario 2: Auto-pay fetch (buffered)
  it('auto-pays and gets a completion via handleFetch', async () => {
    const credStore = new InMemoryCredentialStore()
    const spendTracker = new SpendTracker()
    const { payInvoice, getCallCount } = createMockPayInvoice(preimageMap)

    const result = await handleFetch(
      {
        url: `${baseUrl}/v1/chat/completions`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test-model',
          messages: [{ role: 'user', content: 'hello' }],
        }),
        autoPay: true,
      },
      {
        credentialStore: credStore as any,
        fetchFn: fetch,
        payInvoice,
        maxAutoPaySats: 10_000,
        maxSpendPerMinuteSats: 100_000,
        spendTracker,
        parseL402: parseL402Challenge,
        decodeBolt11,
        detectServer,
      },
    )

    const data = JSON.parse(result.content[0].text)

    // Payment happened
    expect(getCallCount()).toBe(1)
    expect(data.status).toBe(200)
    expect(data.satsPaid).toBeGreaterThan(0)

    // Got a real completion
    const body = JSON.parse(data.body)
    expect(body.choices[0].message.content).toBe('Hello from token-toll!')
    expect(body.usage.total_tokens).toBe(15)

    // Credential stored (server is null because detectServer sees 'generic' —
    // toll-booth doesn't set x-powered-by header)
    const origin = new URL(baseUrl).origin
    const cred = credStore.get(origin)
    expect(cred).toBeDefined()
    expect(cred!.server).toBeNull()
  })

  // Scenario 3: Credential reuse
  it('reuses stored credentials without paying again', async () => {
    const credStore = new InMemoryCredentialStore()
    const spendTracker = new SpendTracker()
    const { payInvoice, getCallCount } = createMockPayInvoice(preimageMap)

    const fetchDeps = {
      credentialStore: credStore as any,
      fetchFn: fetch,
      payInvoice,
      maxAutoPaySats: 10_000,
      maxSpendPerMinuteSats: 100_000,
      spendTracker,
      parseL402: parseL402Challenge,
      decodeBolt11,
      detectServer,
    }

    const body = JSON.stringify({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
    })
    const args = {
      url: `${baseUrl}/v1/chat/completions`,
      method: 'POST' as const,
      headers: { 'Content-Type': 'application/json' },
      body,
      autoPay: true,
    }

    // First request — pays
    const r1 = await handleFetch(args, fetchDeps)
    const d1 = JSON.parse(r1.content[0].text)
    expect(d1.status).toBe(200)
    expect(getCallCount()).toBe(1)

    // Second request — reuses credential
    const r2 = await handleFetch(args, fetchDeps)
    const d2 = JSON.parse(r2.content[0].text)
    expect(d2.status).toBe(200)
    expect(getCallCount()).toBe(1) // unchanged — no new payment

    // Credits remaining should be reported
    expect(d2.creditsRemaining).toBeDefined()
  })

  // Scenario 4: Credit exhaustion
  it('returns 402 when credits are exhausted', async () => {
    const credStore = new InMemoryCredentialStore()
    const spendTracker = new SpendTracker()
    const { payInvoice, getCallCount } = createMockPayInvoice(preimageMap)

    const fetchDeps = {
      credentialStore: credStore as any,
      fetchFn: fetch,
      payInvoice,
      maxAutoPaySats: 10_000,
      maxSpendPerMinuteSats: 100_000,
      spendTracker,
      parseL402: parseL402Challenge,
      decodeBolt11,
      detectServer,
    }

    const body = JSON.stringify({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
    })
    const args = {
      url: `${baseUrl}/v1/chat/completions`,
      method: 'POST' as const,
      headers: { 'Content-Type': 'application/json' },
      body,
      autoPay: true,
    }

    // First request — pays and gets completion
    const r1 = await handleFetch(args, fetchDeps)
    const d1 = JSON.parse(r1.content[0].text)
    expect(d1.status).toBe(200)
    expect(getCallCount()).toBe(1)

    // Drain credits by making requests until 402.
    // With defaultInvoiceAmount=100 sats (from tiers[0]) and pricing.default=1,
    // each request costs ~1 sat, so we need ~100 requests to exhaust credit.
    let exhausted = false
    for (let i = 0; i < 150; i++) {
      const r = await handleFetch(args, fetchDeps)
      const d = JSON.parse(r.content[0].text)
      if (d.status === 402) {
        exhausted = true
        expect(d.creditsExhausted).toBe(true)
        break
      }
    }
    expect(exhausted).toBe(true)

    // Credential should be deleted from store
    const origin = new URL(baseUrl).origin
    expect(credStore.get(origin)).toBeUndefined()
  })

  // Scenario 5: Streaming
  it('auto-pays and gets a streaming completion', async () => {
    const credStore = new InMemoryCredentialStore()
    const spendTracker = new SpendTracker()
    const { payInvoice, getCallCount } = createMockPayInvoice(preimageMap)

    const result = await handleFetch(
      {
        url: `${baseUrl}/v1/chat/completions`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test-model',
          messages: [{ role: 'user', content: 'hello' }],
          stream: true,
        }),
        autoPay: true,
      },
      {
        credentialStore: credStore as any,
        fetchFn: fetch,
        payInvoice,
        maxAutoPaySats: 10_000,
        maxSpendPerMinuteSats: 100_000,
        spendTracker,
        parseL402: parseL402Challenge,
        decodeBolt11,
        detectServer,
      },
    )

    const data = JSON.parse(result.content[0].text)
    expect(data.status).toBe(200)
    expect(getCallCount()).toBe(1)

    // handleFetch buffers the response via response.text()
    expect(data.body).toContain('data:')
    expect(data.body).toContain('[DONE]')
    expect(data.body).toContain('Hello')
    expect(data.body).toContain('world')
  })
})
