import { describe, it, expect } from 'vitest'
import { loadConfig } from './config.js'

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

  it('accepts lightning config from CLI args', () => {
    const config = loadConfig({
      upstream: 'http://localhost:11434',
      lightning: 'phoenixd',
      lightningKey: 'mypassword',
    })
    expect(config.lightning).toBe('phoenixd')
    expect(config.lightningUrl).toBe('http://localhost:9740')
    expect(config.lightningKey).toBe('mypassword')
  })

  it('defaults lightning URL per backend', () => {
    const phoenixd = loadConfig({ upstream: 'http://x', lightning: 'phoenixd', lightningKey: 'pw' })
    expect(phoenixd.lightningUrl).toBe('http://localhost:9740')

    const lnbits = loadConfig({ upstream: 'http://x', lightning: 'lnbits', lightningKey: 'k' })
    expect(lnbits.lightningUrl).toBe('https://legend.lnbits.com')

    const lnd = loadConfig({ upstream: 'http://x', lightning: 'lnd', lightningKey: 'mac' })
    expect(lnd.lightningUrl).toBe('https://localhost:8080')

    const cln = loadConfig({ upstream: 'http://x', lightning: 'cln', lightningKey: 'rune' })
    expect(cln.lightningUrl).toBe('http://localhost:3010')
  })

  it('infers auth mode from lightning flag', () => {
    const config = loadConfig({
      upstream: 'http://localhost:11434',
      lightning: 'phoenixd',
      lightningKey: 'pw',
    })
    expect(config.authMode).toBe('lightning')
  })

  it('defaults auth mode to open when no lightning', () => {
    const config = loadConfig({ upstream: 'http://localhost:11434' })
    expect(config.authMode).toBe('open')
  })

  it('allows explicit auth mode override', () => {
    const config = loadConfig({
      upstream: 'http://localhost:11434',
      lightning: 'phoenixd',
      lightningKey: 'pw',
      authMode: 'open',
    })
    expect(config.authMode).toBe('open')
  })

  it('errors when auth is lightning but no lightning backend', () => {
    expect(() => loadConfig({
      upstream: 'http://localhost:11434',
      authMode: 'lightning',
    })).toThrow(/auth mode 'lightning' requires --lightning/)
  })

  it('errors when auth is allowlist but allowlist is empty', () => {
    expect(() => loadConfig({
      upstream: 'http://localhost:11434',
      authMode: 'allowlist',
    })).toThrow(/auth mode 'allowlist' requires --allowlist/)
  })

  it('accepts allowlist config', () => {
    const config = loadConfig({
      upstream: 'http://localhost:11434',
      authMode: 'allowlist',
      allowlist: ['npub1abc', 'secret123'],
    })
    expect(config.authMode).toBe('allowlist')
    expect(config.allowlist).toEqual(['npub1abc', 'secret123'])
  })

  it('sets flatPricing true when price is set via CLI args', () => {
    const config = loadConfig({ upstream: 'http://localhost:11434', price: 5 })
    expect(config.flatPricing).toBe(true)
    expect(config.price).toBe(5)
    // pricing.default should NOT be affected by flat price
    expect(config.pricing.default).toBe(1)
  })

  it('sets flatPricing false when pricing.models is in file config', () => {
    const config = loadConfig(
      { upstream: 'http://localhost:11434' },
      {},
      { pricing: { default: 2, models: { llama3: 3 } } },
    )
    expect(config.flatPricing).toBe(false)
    // pricing.default should come from file config
    expect(config.pricing.default).toBe(2)
  })

  it('sets flatPricing false when pricing.default is in file config (no models)', () => {
    const config = loadConfig(
      { upstream: 'http://localhost:11434' },
      {},
      { pricing: { default: 2 } },
    )
    expect(config.flatPricing).toBe(false)
    expect(config.pricing.default).toBe(2)
  })

  it('CLI --price wins over file pricing.models (flat mode)', () => {
    const config = loadConfig(
      { upstream: 'http://localhost:11434', price: 5 },
      {},
      { pricing: { default: 2, models: { llama3: 3 } } },
    )
    expect(config.flatPricing).toBe(true)
    expect(config.price).toBe(5)
    // per-token pricing still populated for advanced use
    expect(config.pricing.default).toBe(2)
    expect(config.pricing.models.llama3).toBe(3)
  })

  it('defaults to flat pricing with price=1 when no pricing configured', () => {
    const config = loadConfig({ upstream: 'http://localhost:11434' })
    expect(config.flatPricing).toBe(true)
    expect(config.price).toBe(1)
  })

  it('reads lightning config from env vars', () => {
    const config = loadConfig(
      { upstream: 'http://localhost:11434' },
      { LIGHTNING_BACKEND: 'lnbits', LIGHTNING_KEY: 'apikey', LIGHTNING_URL: 'https://my.lnbits.com' },
    )
    expect(config.lightning).toBe('lnbits')
    expect(config.lightningKey).toBe('apikey')
    expect(config.lightningUrl).toBe('https://my.lnbits.com')
  })

  it('reads auth mode from env var', () => {
    const config = loadConfig(
      { upstream: 'http://localhost:11434' },
      { AUTH_MODE: 'open' },
    )
    expect(config.authMode).toBe('open')
  })

  it('rejects invalid storage type', () => {
    expect(() => loadConfig({
      upstream: 'http://localhost:11434',
      storage: 'redis',
    })).toThrow(/Invalid storage type/)
  })

  it('rejects dbPath outside working directory', () => {
    expect(() => loadConfig({
      upstream: 'http://localhost:11434',
      dbPath: '/etc/token-toll.db',
    })).toThrow(/dbPath must be within the working directory/)
  })

  it('rejects dbPath with traversal', () => {
    expect(() => loadConfig({
      upstream: 'http://localhost:11434',
      dbPath: '../../etc/token-toll.db',
    })).toThrow(/dbPath must be within the working directory/)
  })

  it('accepts dbPath within cwd', () => {
    const config = loadConfig({
      upstream: 'http://localhost:11434',
      dbPath: './data/token-toll.db',
    })
    expect(config.dbPath).toBe('./data/token-toll.db')
  })

  it('rejects invalid lightning backend', () => {
    expect(() => loadConfig({
      upstream: 'http://localhost:11434',
      lightning: 'fakend',
      lightningKey: 'key',
    })).toThrow(/Invalid lightning backend/)
  })

  it('rejects invalid auth mode', () => {
    expect(() => loadConfig({
      upstream: 'http://localhost:11434',
      authMode: 'magic',
    })).toThrow(/Invalid auth mode/)
  })

  it('rejects invalid upstream URL scheme', () => {
    expect(() => loadConfig({
      upstream: 'ftp://localhost:11434',
    })).toThrow(/http or https/)
  })

  it('rejects non-URL upstream', () => {
    expect(() => loadConfig({
      upstream: 'not a url',
    })).toThrow(/not a valid URL/)
  })

  it('rejects NaN port', () => {
    expect(() => loadConfig({
      upstream: 'http://localhost:11434',
      port: NaN,
    })).toThrow(/Invalid port/)
  })

  it('rejects port out of range', () => {
    expect(() => loadConfig({
      upstream: 'http://localhost:11434',
      port: 70000,
    })).toThrow(/Invalid port/)
  })

  it('rejects negative price', () => {
    expect(() => loadConfig({
      upstream: 'http://localhost:11434',
      price: -5,
    })).toThrow(/Invalid price/)
  })

  it('rejects NaN free tier', () => {
    expect(() => loadConfig({
      upstream: 'http://localhost:11434',
      freeTier: NaN,
    })).toThrow(/Invalid free tier/)
  })

  it('rejects NaN max concurrent', () => {
    expect(() => loadConfig({
      upstream: 'http://localhost:11434',
      maxConcurrent: NaN,
    })).toThrow(/Invalid max concurrent/)
  })

  it('reads tunnel config from env and CLI', () => {
    const withEnv = loadConfig(
      { upstream: 'http://localhost:11434' },
      { TUNNEL: 'false' },
    )
    expect(withEnv.tunnel).toBe(false)

    const withCli = loadConfig({
      upstream: 'http://localhost:11434',
      noTunnel: true,
    })
    expect(withCli.tunnel).toBe(false)
  })
})

describe('x402 config', () => {
  it('parses x402 config from env vars', () => {
    const config = loadConfig(
      { upstream: 'http://localhost:11434' },
      {
        X402_RECEIVER: '0xabc123',
        X402_NETWORK: 'base',
        X402_FACILITATOR_URL: 'https://x402.org/facilitator',
        X402_FACILITATOR_KEY: 'test-key',
      },
    )
    expect(config.x402).toEqual({
      receiverAddress: '0xabc123',
      network: 'base',
      facilitatorUrl: 'https://x402.org/facilitator',
      facilitatorKey: 'test-key',
      asset: undefined,
      creditMode: undefined,
    })
  })

  it('parses x402 config from file', () => {
    const config = loadConfig(
      { upstream: 'http://localhost:11434' },
      {},
      {
        x402: {
          receiverAddress: '0xdef456',
          network: 'polygon',
          creditMode: false,
        },
      },
    )
    expect(config.x402?.receiverAddress).toBe('0xdef456')
    expect(config.x402?.network).toBe('polygon')
    expect(config.x402?.creditMode).toBe(false)
  })

  it('x402 is undefined when receiver not set', () => {
    const config = loadConfig({ upstream: 'http://localhost:11434' })
    expect(config.x402).toBeUndefined()
  })

  it('x402 is undefined when only receiver but no network', () => {
    const config = loadConfig(
      { upstream: 'http://localhost:11434' },
      { X402_RECEIVER: '0xabc' },
    )
    expect(config.x402).toBeUndefined()
  })

  it('parses DEFAULT_PRICE_USD from env', () => {
    const config = loadConfig(
      { upstream: 'http://localhost:11434' },
      { DEFAULT_PRICE_USD: '5' },
    )
    expect(config.defaultPriceUsd).toBe(5)
  })

  it('parses defaultPriceUsd from file config', () => {
    const config = loadConfig(
      { upstream: 'http://localhost:11434' },
      {},
      { defaultPriceUsd: 10 },
    )
    expect(config.defaultPriceUsd).toBe(10)
  })

  it('defaultPriceUsd is undefined when not set', () => {
    const config = loadConfig({ upstream: 'http://localhost:11434' })
    expect(config.defaultPriceUsd).toBeUndefined()
  })
})

describe('logging config', () => {
  it('defaults verbose to false', () => {
    const config = loadConfig({ upstream: 'http://localhost:1234' })
    expect(config.verbose).toBe(false)
  })

  it('defaults logFormat to pretty', () => {
    const config = loadConfig({ upstream: 'http://localhost:1234' })
    expect(config.logFormat).toBe('pretty')
  })

  it('accepts verbose from CLI args', () => {
    const config = loadConfig({ upstream: 'http://localhost:1234', verbose: true })
    expect(config.verbose).toBe(true)
  })

  it('accepts logFormat from env', () => {
    const config = loadConfig({ upstream: 'http://localhost:1234' }, { TOKEN_TOLL_LOG_FORMAT: 'json' })
    expect(config.logFormat).toBe('json')
  })

  it('rejects invalid logFormat', () => {
    expect(() => loadConfig({ upstream: 'http://localhost:1234' }, { TOKEN_TOLL_LOG_FORMAT: 'xml' }))
      .toThrow('Invalid log format')
  })
})
