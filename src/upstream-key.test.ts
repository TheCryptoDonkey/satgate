import { describe, it, expect, afterEach } from 'vitest'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createTokenTollServer } from './server.js'
import { loadConfig } from './config.js'

let server: ReturnType<typeof serve> | undefined
afterEach(() => server?.close())

async function recordingUpstream() {
  const seen: Array<string | undefined> = []
  const app = new Hono()
  app.post('/v1/chat/completions', (c) => {
    seen.push(c.req.header('authorization'))
    return c.json({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } })
  })
  app.get('/v1/models', (c) => {
    seen.push(c.req.header('authorization'))
    return c.json({ data: [{ id: 'm' }] })
  })
  const url = await new Promise<string>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => resolve(`http://localhost:${info.port}`))
  })
  return { url, seen }
}

function openConfig(upstream: string, upstreamKey?: string) {
  return {
    ...loadConfig({ upstream }),
    authMode: 'allowlist' as const,
    allowlist: ['client-secret'],
    upstreamKey,
  }
}

describe('upstream API key', () => {
  it('sends the configured key upstream instead of the client credential', async () => {
    const up = await recordingUpstream()
    const { app } = createTokenTollServer(openConfig(up.url, 'sk-upstream'))
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer client-secret' },
      body: JSON.stringify({ model: 'm', messages: [] }),
    })
    expect(res.status).toBe(200)
    await app.request('/v1/models')
    expect(up.seen).toEqual(['Bearer sk-upstream', 'Bearer sk-upstream'])
  })

  it('sends no Authorization header when no key is configured', async () => {
    const up = await recordingUpstream()
    const { app } = createTokenTollServer(openConfig(up.url))
    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer client-secret' },
      body: JSON.stringify({ model: 'm', messages: [] }),
    })
    expect(up.seen).toEqual([undefined])
  })

  it('reads UPSTREAM_API_KEY', () => {
    expect(loadConfig({ upstream: 'http://x' }, { UPSTREAM_API_KEY: ' sk-env \n' }).upstreamKey).toBe('sk-env')
    expect(loadConfig({ upstream: 'http://x' }).upstreamKey).toBeUndefined()
  })
})
