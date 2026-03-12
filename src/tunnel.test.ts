import { describe, it, expect } from 'vitest'
import { findCloudflared, parseTunnelUrl } from './tunnel.js'

describe('parseTunnelUrl', () => {
  it('extracts URL from cloudflared stderr output', () => {
    const lines = [
      '2026-03-12T10:00:00Z INF Starting tunnel',
      '2026-03-12T10:00:01Z INF +-----------------------------------+',
      '2026-03-12T10:00:01Z INF |  Your quick Tunnel has been created!',
      '2026-03-12T10:00:01Z INF +-----------------------------------+',
      '2026-03-12T10:00:01Z INF https://abc-xyz-123.trycloudflare.com',
    ]
    expect(parseTunnelUrl(lines.join('\n'))).toBe('https://abc-xyz-123.trycloudflare.com')
  })

  it('returns undefined when no URL found', () => {
    expect(parseTunnelUrl('some random output')).toBeUndefined()
  })
})

describe('findCloudflared', () => {
  it('returns path or null without throwing', () => {
    const result = findCloudflared()
    expect(result === null || typeof result === 'string').toBe(true)
  })
})
