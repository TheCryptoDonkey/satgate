import { describe, it, expect } from 'vitest'
import { loadConfig } from '../../src/config.js'

const base = {
  upstream: 'http://localhost:11434',
}

describe('Cashu config parsing', () => {
  it('parses cashu from file config', () => {
    const config = loadConfig(base, {}, {
      cashu: { mints: ['https://mint.example.com'], unit: 'sat' },
    })
    expect(config.cashu).toEqual({ mints: ['https://mint.example.com'], unit: 'sat' })
  })

  it('defaults unit to sat when omitted', () => {
    const config = loadConfig(base, {}, {
      cashu: { mints: ['https://mint.example.com'] },
    })
    expect(config.cashu!.unit).toBe('sat')
  })

  it('parses cashu mints from CLI args', () => {
    const config = loadConfig({
      ...base,
      cashuMints: 'https://mint1.example.com,https://mint2.example.com',
    }, {}, {})
    expect(config.cashu!.mints).toEqual(['https://mint1.example.com', 'https://mint2.example.com'])
  })

  it('parses cashu mints from env var', () => {
    const config = loadConfig(base, {
      CASHU_MINTS: 'https://mint.example.com',
    }, {})
    expect(config.cashu!.mints).toEqual(['https://mint.example.com'])
  })

  it('CLI args take precedence over env vars', () => {
    const config = loadConfig({
      ...base,
      cashuMints: 'https://cli-mint.example.com',
    }, {
      CASHU_MINTS: 'https://env-mint.example.com',
    }, {})
    expect(config.cashu!.mints).toEqual(['https://cli-mint.example.com'])
  })

  it('throws on invalid mint URL', () => {
    expect(() => loadConfig(base, {}, {
      cashu: { mints: ['not-a-url'] },
    })).toThrow('Cashu mint URL')
  })

  it('throws on empty mints array', () => {
    expect(() => loadConfig(base, {}, {
      cashu: { mints: [] },
    })).toThrow('at least one mint')
  })

  it('throws on invalid unit', () => {
    expect(() => loadConfig(base, {}, {
      cashu: { mints: ['https://mint.example.com'], unit: 'btc' },
    })).toThrow('unit')
  })

  it('returns undefined cashu when not configured', () => {
    const config = loadConfig(base, {}, {})
    expect(config.cashu).toBeUndefined()
  })
})

describe('Auth mode inference with Cashu', () => {
  it('infers cashu auth mode when only cashu configured', () => {
    const config = loadConfig(base, {}, {
      cashu: { mints: ['https://mint.example.com'] },
    })
    expect(config.authMode).toBe('cashu')
  })

  it('infers lightning auth mode when both configured', () => {
    const config = loadConfig({
      ...base,
      lightning: 'phoenixd',
      lightningKey: 'test-key',
    }, {}, {
      cashu: { mints: ['https://mint.example.com'] },
    })
    expect(config.authMode).toBe('lightning')
    expect(config.cashu).toBeDefined()
  })

  it('throws when explicit --auth cashu but no mints', () => {
    expect(() => loadConfig({
      ...base,
      authMode: 'cashu',
    }, {}, {})).toThrow("auth mode 'cashu' requires")
  })

  it('open mode when neither lightning nor cashu', () => {
    const config = loadConfig(base, {}, {})
    expect(config.authMode).toBe('open')
  })
})
