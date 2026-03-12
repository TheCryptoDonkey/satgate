import { describe, it, expect } from 'vitest'
import { createLightningBackend } from './lightning.js'

describe('createLightningBackend', () => {
  it('returns undefined when no backend specified', () => {
    expect(createLightningBackend({})).toBeUndefined()
  })

  it('creates phoenixd backend', () => {
    const backend = createLightningBackend({
      lightning: 'phoenixd',
      lightningUrl: 'http://localhost:9740',
      lightningKey: 'mypassword',
    })
    expect(backend).toBeDefined()
    expect(backend!.createInvoice).toBeTypeOf('function')
    expect(backend!.checkInvoice).toBeTypeOf('function')
  })

  it('creates lnbits backend', () => {
    const backend = createLightningBackend({
      lightning: 'lnbits',
      lightningUrl: 'https://legend.lnbits.com',
      lightningKey: 'apikey',
    })
    expect(backend).toBeDefined()
  })

  it('creates lnd backend with hex macaroon', () => {
    const backend = createLightningBackend({
      lightning: 'lnd',
      lightningUrl: 'https://localhost:8080',
      lightningKey: '0201036c6e640004',
    })
    expect(backend).toBeDefined()
  })

  it('creates cln backend', () => {
    const backend = createLightningBackend({
      lightning: 'cln',
      lightningUrl: 'http://localhost:3010',
      lightningKey: 'rune_abc',
    })
    expect(backend).toBeDefined()
  })

  it('throws on missing key', () => {
    expect(() => createLightningBackend({
      lightning: 'phoenixd',
      lightningUrl: 'http://localhost:9740',
    })).toThrow(/--lightning-key is required/)
  })

  it('throws on unknown backend', () => {
    expect(() => createLightningBackend({
      lightning: 'unknown' as any,
      lightningUrl: 'http://x',
      lightningKey: 'k',
    })).toThrow(/Unknown lightning backend/)
  })
})
