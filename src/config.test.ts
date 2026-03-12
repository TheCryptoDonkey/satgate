import { describe, it, expect } from 'vitest'
import { loadConfig, type TokenTollConfig } from './config.js'

describe('loadConfig', () => {
  it('returns defaults when no config provided', () => {
    const config = loadConfig({ upstream: 'http://localhost:11434' })
    expect(config.upstream).toBe('http://localhost:11434')
    expect(config.port).toBe(3000)
    expect(config.pricing.default).toBe(1)
    expect(config.storage).toBe('memory')
    expect(config.capacity.maxConcurrent).toBe(0)
    expect(config.freeTier.requestsPerDay).toBe(0)
  })

  it('requires upstream URL', () => {
    expect(() => loadConfig({})).toThrow(/upstream/)
  })

  it('CLI args override env vars', () => {
    const config = loadConfig(
      { upstream: 'http://cli', port: 4000 },
      { UPSTREAM_URL: 'http://env', PORT: '5000' },
    )
    expect(config.upstream).toBe('http://cli')
    expect(config.port).toBe(4000)
  })

  it('env vars override config file', () => {
    const config = loadConfig(
      {},
      { UPSTREAM_URL: 'http://env', DEFAULT_PRICE: '3' },
      { upstream: 'http://file', pricing: { default: 1, models: {} } },
    )
    expect(config.upstream).toBe('http://env')
    expect(config.pricing.default).toBe(3)
  })

  it('parses model pricing from config file', () => {
    const config = loadConfig(
      { upstream: 'http://localhost:11434' },
      {},
      { pricing: { default: 1, models: { llama3: 2, 'deepseek-r1': 5 } } },
    )
    expect(config.pricing.models.llama3).toBe(2)
    expect(config.pricing.models['deepseek-r1']).toBe(5)
  })

  it('parses tiers from config file', () => {
    const config = loadConfig(
      { upstream: 'http://localhost:11434' },
      {},
      { tiers: [{ amountSats: 1000, creditSats: 1000, label: '1k' }] },
    )
    expect(config.tiers).toHaveLength(1)
    expect(config.tiers[0].amountSats).toBe(1000)
  })

  it('generates root key if not provided', () => {
    const config = loadConfig({ upstream: 'http://localhost:11434' })
    expect(config.rootKey).toMatch(/^[0-9a-f]{64}$/)
    expect(config.rootKeyGenerated).toBe(true)
  })

  it('uses provided root key', () => {
    const key = 'a'.repeat(64)
    const config = loadConfig({ upstream: 'http://localhost:11434', rootKey: key })
    expect(config.rootKey).toBe(key)
    expect(config.rootKeyGenerated).toBe(false)
  })
})
