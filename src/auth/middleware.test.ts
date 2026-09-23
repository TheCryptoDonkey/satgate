import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createAuthMiddleware } from './middleware.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js'
import { createHash } from 'node:crypto'

describe('createAuthMiddleware', () => {
  it('passes all requests in open mode', async () => {
    const app = new Hono()
    const middleware = createAuthMiddleware({ authMode: 'open', allowlist: [] })
    app.use('/v1/*', middleware)
    app.post('/v1/chat/completions', (c) => c.json({ ok: true }))

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
  })

  it('returns 403 for unauthorised allowlist request', async () => {
    const app = new Hono()
    const middleware = createAuthMiddleware({
      authMode: 'allowlist',
      allowlist: ['secret-abc'],
    })
    app.use('/v1/*', middleware)
    app.post('/v1/chat/completions', (c) => c.json({ ok: true }))

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(403)
  })

  it('passes authorised allowlist request', async () => {
    const app = new Hono()
    const middleware = createAuthMiddleware({
      authMode: 'allowlist',
      allowlist: ['secret-abc'],
    })
    app.use('/v1/*', middleware)
    app.post('/v1/chat/completions', (c) => c.json({ ok: true }))

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer secret-abc',
      },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
  })

  it('passes through in lightning mode (toll-booth handles auth separately)', async () => {
    const app = new Hono()
    const middleware = createAuthMiddleware({ authMode: 'lightning', allowlist: [] })
    app.use('/v1/*', middleware)
    app.post('/v1/chat/completions', (c) => c.json({ ok: true }))

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
  })
})

describe('NIP-98 behind a TLS proxy', () => {
  function nip98(privateKey: Uint8Array, url: string, method: string): string {
    const pubkey = bytesToHex(schnorr.getPublicKey(privateKey))
    const event = { pubkey, created_at: Math.floor(Date.now() / 1000), kind: 27235, tags: [['u', url], ['method', method]], content: Math.random().toString(36) }
    const id = createHash('sha256').update(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])).digest('hex')
    const sig = bytesToHex(schnorr.sign(hexToBytes(id), privateKey))
    return `Nostr ${btoa(JSON.stringify({ ...event, id, sig }))}`
  }

  const key = schnorr.utils.randomSecretKey()
  const pubkey = bytesToHex(schnorr.getPublicKey(key))

  function appWith(config: { publicUrl?: string; trustProxy?: boolean }) {
    const app = new Hono()
    app.use('/v1/*', createAuthMiddleware({ authMode: 'allowlist', allowlist: [pubkey], ...config }))
    app.post('/v1/chat/completions', (c) => c.json({ ok: true }))
    return app
  }

  // The proxy talks to satgate over plain HTTP on loopback
  const internal = 'http://127.0.0.1:3000/v1/chat/completions'

  it('accepts a u tag for the configured public URL', async () => {
    const app = appWith({ publicUrl: 'https://ai.example.com' })
    const res = await app.request(internal, {
      method: 'POST',
      headers: { Authorization: nip98(key, 'https://ai.example.com/v1/chat/completions', 'POST') },
    })
    expect(res.status).toBe(200)
  })

  it('accepts a u tag rebuilt from trusted forwarded headers', async () => {
    const app = appWith({ trustProxy: true })
    const res = await app.request(internal, {
      method: 'POST',
      headers: {
        Authorization: nip98(key, 'https://ai.example.com/v1/chat/completions', 'POST'),
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'ai.example.com',
      },
    })
    expect(res.status).toBe(200)
  })

  it('ignores forwarded headers unless the proxy is trusted', async () => {
    const app = appWith({})
    const res = await app.request(internal, {
      method: 'POST',
      headers: {
        Authorization: nip98(key, 'https://ai.example.com/v1/chat/completions', 'POST'),
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'ai.example.com',
      },
    })
    expect(res.status).toBe(403)
  })

  it('still refuses a u tag for some other service', async () => {
    const app = appWith({ publicUrl: 'https://ai.example.com' })
    const res = await app.request(internal, {
      method: 'POST',
      headers: { Authorization: nip98(key, 'https://other.example.com/v1/chat/completions', 'POST') },
    })
    expect(res.status).toBe(403)
  })
})
