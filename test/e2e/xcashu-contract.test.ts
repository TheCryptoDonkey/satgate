/**
 * Contract test: verifies satgate's xcashu challenge can be parsed by 402-mcp's client.
 * This proves the two repos agree on the NUT-18 payment request format.
 * Does NOT test actual Cashu mint interaction (that's toll-booth's responsibility).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createTokenTollServer } from '../../src/server.js'
import { isXCashuChallenge, parseXCashuChallenge } from '../../src/xcashu-contract-helper.js'

function mockUpstream() {
  const app = new Hono()
  app.post('/v1/chat/completions', (c) => {
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
  freeTier: { creditsPerDay: 0 },
  capacity: { maxConcurrent: 0 },
  tiers: [],
  trustProxy: false,
  estimatedCostSats: 10,
  maxBodySize: 10 * 1024 * 1024,
  allowlist: [],
  flatPricing: false,
  price: 0,
  tunnel: false,
  verbose: false,
  logFormat: 'pretty' as const,
  serviceName: 'satgate',
  announce: false,
  announceRelays: [],
  announceKey: '',
}

describe('xcashu contract: satgate challenge ↔ 402-mcp parser', () => {
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

  it('satgate xcashu challenge is parseable by 402-mcp NUT-18 parser', async () => {
    const mintUrl = 'https://mint.example.com'
    const { app } = createTokenTollServer({
      ...baseConfig,
      upstream: upstreamUrl,
      authMode: 'cashu' as const,
      cashu: { mints: [mintUrl], unit: 'sat' as const },
    })

    // Step 1: Get 402 challenge from satgate
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    })

    expect(res.status).toBe(402)

    // Step 2: Parse the X-Cashu header using 402-mcp's parser
    const headers = res.headers
    expect(isXCashuChallenge(headers)).toBe(true)

    const xcashuHeader = headers.get('x-cashu')!
    const challenge = parseXCashuChallenge(xcashuHeader)

    expect(challenge).not.toBeNull()
    expect(challenge!.amount).toBeGreaterThan(0)
    expect(challenge!.unit).toBe('sat')
    expect(challenge!.mints).toContain(mintUrl)
  })

  it('well-known l402 cashu metadata matches challenge mints', async () => {
    const mintUrl = 'https://mint.example.com'
    const { app } = createTokenTollServer({
      ...baseConfig,
      upstream: upstreamUrl,
      authMode: 'cashu' as const,
      cashu: { mints: [mintUrl], unit: 'sat' as const },
    })

    // Get well-known
    const wellKnown = await app.request('/.well-known/l402')
    const body = await wellKnown.json() as any

    // Get challenge
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    })
    const challenge = parseXCashuChallenge(res.headers.get('x-cashu')!)

    // Mints in well-known should match mints in challenge
    expect(body.payment.cashu.mints).toEqual(challenge!.mints)
    expect(body.payment.cashu.unit).toBe(challenge!.unit)
  })
})
