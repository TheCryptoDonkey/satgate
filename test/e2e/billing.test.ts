import { describe, it, expect, afterEach } from 'vitest'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createTokenTollServer } from '../../src/server.js'
import type { TokenTollConfig } from '../../src/config.js'
import { createPreimageBackend, buyL402Credential, buyIetfCharge } from './helpers/l402-wallet.js'

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

describe('max_tokens reservation', () => {
  it('clamps max_tokens to the operator cap, and sets it when absent', async () => {
    upstream = await startUpstream()
    const { app } = createTokenTollServer(paidConfig(upstream.url, { authMode: 'open', lightning: undefined, maxTokens: 100 }))
    await app.request('/v1/chat/completions', chat('', 'hi', { max_tokens: 5000 }))
    await app.request('/v1/chat/completions', chat('', 'hi'))
    await app.request('/v1/chat/completions', chat('', 'hi', { max_completion_tokens: 50 }))
    expect(upstream.bodies.map(b => b.max_tokens)).toEqual([100, 100, 50])
    expect(upstream.bodies[2].max_completion_tokens).toBe(50)
  })

  it('reserves the worst case from the balance and refunds down to the actual cost', async () => {
    upstream = await startUpstream()
    const { backend, preimages } = createPreimageBackend()
    // 100 sats per 1k tokens: a 1000-token completion costs 100 sats
    const { app } = createTokenTollServer(paidConfig(upstream.url, {
      backend,
      pricing: { default: 100, models: {} },
      estimatedCostSats: 10,
      maxTokens: 4000,
    }))
    const auth = await buyL402Credential(app, preimages)

    const res = await app.request('/v1/chat/completions', chat(auth, 'tokens=1000', { max_tokens: 4000 }))
    expect(res.status).toBe(200)
    // Charged the actual 1000 tokens (100 sats), not the 10-sat estimate
    const probe = await app.request('/v1/chat/completions', chat(auth, 'tokens=0', { max_tokens: 1 }))
    expect(probe.headers.get('X-Credit-Balance')).toBe(String(1000 - 100 - 10))
  })

  it('refuses a request whose worst case the balance cannot cover', async () => {
    upstream = await startUpstream()
    const { backend, preimages } = createPreimageBackend()
    const { app } = createTokenTollServer(paidConfig(upstream.url, {
      backend,
      pricing: { default: 100, models: {} },
      estimatedCostSats: 10,
      maxTokens: 20_000,
    }))
    const auth = await buyL402Credential(app, preimages)

    // 20k tokens at 100 sats/1k is 2000 sats; the credential holds 1000
    const res = await app.request('/v1/chat/completions', chat(auth, 'tokens=1', { max_tokens: 20_000 }))
    expect(res.status).toBe(402)
    expect(upstream.bodies).toHaveLength(0)
    const body = await res.json()
    expect(body.reserve_sats).toBeGreaterThan(1000)

    // Nothing was kept: the next small request sees the full balance less its hold
    const probe = await app.request('/v1/chat/completions', chat(auth, 'tokens=0', { max_tokens: 1 }))
    expect(probe.headers.get('X-Credit-Balance')).toBe(String(1000 - 10))
  })

  it('counts every choice asked for with n', async () => {
    upstream = await startUpstream()
    const { backend, preimages } = createPreimageBackend()
    const { app } = createTokenTollServer(paidConfig(upstream.url, {
      backend,
      pricing: { default: 100, models: {} },
      maxTokens: 3000,
    }))
    const auth = await buyL402Credential(app, preimages)
    // 3000 tokens is 300 sats; four choices is 1200, more than the balance
    const res = await app.request('/v1/chat/completions', chat(auth, 'hi', { max_tokens: 3000, n: 4 }))
    expect(res.status).toBe(402)
    const tooMany = await app.request('/v1/chat/completions', chat(auth, 'hi', { n: 50 }))
    expect(tooMany.status).toBe(400)
  })
})

describe('IETF Payment per-request charges', () => {
  it('shrinks max_tokens so the completion fits what was paid', async () => {
    upstream = await startUpstream()
    const { backend, preimages } = createPreimageBackend()
    // 10 sats at 1 sat/1k buys 10k tokens in total
    const { app } = createTokenTollServer(paidConfig(upstream.url, { backend, estimatedCostSats: 10, maxTokens: 20_000 }))
    const auth = await buyIetfCharge(app, preimages)
    const res = await app.request('/v1/chat/completions', chat(auth, 'tokens=1', { max_tokens: 20_000 }))
    expect(res.status).toBe(200)
    const sent = upstream.bodies[0]
    const bodyBytes = Buffer.byteLength(JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'tokens=1' }], max_tokens: 20_000 }))
    expect(sent.max_tokens).toBe(10_000 - bodyBytes)
  })

  it('refuses a prompt larger than what was paid', async () => {
    upstream = await startUpstream()
    const { backend, preimages } = createPreimageBackend()
    const { app } = createTokenTollServer(paidConfig(upstream.url, { backend, estimatedCostSats: 10 }))
    const auth = await buyIetfCharge(app, preimages)
    const res = await app.request('/v1/chat/completions', chat(auth, 'x'.repeat(12_000)))
    expect(res.status).toBe(402)
    expect(upstream.bodies).toHaveLength(0)
  })
})

describe('IETF Payment sessions', () => {
  it('opens a session with a session credential rather than checking it as a charge', async () => {
    upstream = await startUpstream()
    const { backend, preimages } = createPreimageBackend()
    const refundingBackend = { ...backend, sendPayment: async () => ({ paid: true, preimage: '0'.repeat(64) }) }
    const { app } = createTokenTollServer(paidConfig(upstream.url, { backend: refundingBackend as typeof backend, sessionIntent: true, realm: 'satgate-test' }))
    const challengeRes = await app.request('/v1/chat/completions', chat('', 'hi'))
    expect(challengeRes.status).toBe(402)
    const header = challengeRes.headers.get('WWW-Authenticate') ?? ''
    const match = /Payment (id="[^"]+", realm="[^"]+", method="[^"]+", intent="session", request="[^"]+", expires="[^"]+")/.exec(header)
    expect(match).not.toBeNull()
    const challenge: Record<string, string> = {}
    for (const [, key, value] of match![1].matchAll(/(\w+)="([^"]*)"/g)) challenge[key] = value
    const body = await challengeRes.json() as { ietf_session: { payment_hash: string } }
    const preimage = preimages.get(body.ietf_session.payment_hash)!
    const credential = Buffer.from(JSON.stringify({ challenge, payload: { action: 'open', preimage } })).toString('base64url')

    const res = await app.request('/v1/chat/completions', chat(`Payment ${credential}`, 'tokens=1'))
    expect(res.status).toBe(200)
  })
})

describe('client IPs behind a proxy', () => {
  async function freeTierApp(trustProxy: boolean, trustedProxies: string[] = []) {
    upstream = await startUpstream()
    const { backend } = createPreimageBackend()
    // One request's worth of free credit per IP per day
    return createTokenTollServer(paidConfig(upstream.url, {
      backend, trustProxy, trustedProxies, freeTier: { creditsPerDay: 10 }, estimatedCostSats: 10,
    })).app
  }

  function from(ip: string, extra: Record<string, string> = {}) {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...extra },
      body: JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'tokens=1' }], max_tokens: 1 }),
    }
  }

  it('gives each forwarded client its own free-tier allowance', async () => {
    const app = await freeTierApp(true)
    expect((await app.request('/v1/chat/completions', from('203.0.113.1'))).status).toBe(200)
    expect((await app.request('/v1/chat/completions', from('203.0.113.1'))).status).toBe(402)
    expect((await app.request('/v1/chat/completions', from('203.0.113.2'))).status).toBe(200)
  })

  it('skips trusted proxy hops when reading X-Forwarded-For', async () => {
    const app = await freeTierApp(true, ['10.0.0.0/8'])
    expect((await app.request('/v1/chat/completions', from('203.0.113.7, 10.1.2.3'))).status).toBe(200)
    // A different spoofed first hop is still the same client behind the same proxy hop
    expect((await app.request('/v1/chat/completions', from('198.51.100.9, 203.0.113.7, 10.1.2.3'))).status).toBe(402)
    // Another client through the same proxy has its own allowance
    expect((await app.request('/v1/chat/completions', from('203.0.113.8, 10.1.2.3'))).status).toBe(200)
  })
})

describe('which routes are paid', () => {
  function countingBackend() {
    const { backend, preimages } = createPreimageBackend()
    let invoices = 0
    const counted = { ...backend, createInvoice: async (amount: number, memo?: string) => { invoices++; return backend.createInvoice(amount, memo) } }
    return { backend: counted, preimages, invoices: () => invoices }
  }

  it('mints no invoice for other methods or unknown /v1 paths', async () => {
    upstream = await startUpstream()
    const wallet = countingBackend()
    const { app } = createTokenTollServer(paidConfig(upstream.url, { backend: wallet.backend }))
    expect((await app.request('/v1/chat/completions')).status).toBe(404)
    expect((await app.request('/v1/chat/completions', { method: 'PUT' })).status).toBe(404)
    expect((await app.request('/v1/anything', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(404)
    expect(wallet.invoices()).toBe(0)
  })

  it('keeps GET /v1/models free under allowlist auth', async () => {
    upstream = await startUpstream()
    const { app } = createTokenTollServer(paidConfig(upstream.url, { authMode: 'allowlist', allowlist: ['secret'], lightning: undefined }))
    const res = await app.request('/v1/models')
    expect(res.status).toBe(200)
  })

  it('answers a HEAD price probe without touching a credential sent with it', async () => {
    upstream = await startUpstream()
    const wallet = countingBackend()
    const { app } = createTokenTollServer(paidConfig(upstream.url, { backend: wallet.backend }))
    const auth = await buyL402Credential(app, wallet.preimages)
    const probe = await app.request('/v1/chat/completions', { method: 'HEAD', headers: { Authorization: auth } })
    expect(probe.status).toBe(402)
    expect(probe.headers.get('X-L402-Price-Sats')).toBe('10')
    const res = await app.request('/v1/chat/completions', chat(auth, 'tokens=0', { max_tokens: 1 }))
    expect(res.headers.get('X-Credit-Balance')).toBe(String(1000 - 10))
  })
})
