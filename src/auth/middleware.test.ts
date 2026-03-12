import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createAuthMiddleware } from './middleware.js'

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
