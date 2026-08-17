import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('creates nwc backend from an inline URI, with no lightning-url', () => {
    const backend = createLightningBackend({
      lightning: 'nwc',
      lightningKey: `nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2Fnos.lol&secret=${'b'.repeat(64)}`,
    })
    expect(backend).toBeDefined()
    expect(backend!.createInvoice).toBeTypeOf('function')
  })

  it('creates nwc backend from a file, keeping the URI out of the process table', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'satgate-nwc-')), 'uri.txt')
    writeFileSync(file, `nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2Fnos.lol&secret=${'b'.repeat(64)}\n`)
    const backend = createLightningBackend({ lightning: 'nwc', lightningKey: file })
    expect(backend).toBeDefined()
  })

  it('rejects an nwc key that is neither a URI nor a readable file', () => {
    expect(() => createLightningBackend({ lightning: 'nwc', lightningKey: '/no/such/file' }))
      .toThrow(/nostr\+walletconnect/)
  })

  it('never echoes the key back in the error, since it may be the secret itself', () => {
    const secretish = 'nostr+walletconnec://typo-but-secret-looking'
    expect(() => createLightningBackend({ lightning: 'nwc', lightningKey: secretish }))
      .toThrow(expect.not.stringContaining('typo-but-secret-looking'))
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
