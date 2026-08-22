import { describe, it, expect } from 'vitest'
import { buildAnnounceEvent } from '402-announce'
import { announcedPaymentMethods } from './cli.js'
import { loadConfig } from './config.js'
import { generateSecretKey } from 'nostr-tools/pure'
import { bytesToHex } from '@noble/hashes/utils.js'

// Announcing is all-or-nothing.
//
// 402-announce validates rail identifiers against a closed set, and one it
// does not know rejects the WHOLE event rather than dropping a tag. So a
// new rail here does not add itself to the announcement - it removes the
// announcement, and satgate goes silent on Nostr while looking healthy in
// every other way. That is exactly what shipping the lnurlcash rail
// against 402-announce 2.1.1 did, in production, discovered in the
// container log rather than by a test.

const secret = bytesToHex(generateSecretKey())

const configWith = (args: Record<string, unknown>) =>
  loadConfig({ upstream: 'http://localhost:11434', ...args } as never)

const announce = (methods: string[][]) =>
  buildAnnounceEvent(secret, {
    identifier: 'satgate-test',
    name: 'satgate',
    about: 'pay-per-token inference',
    urls: ['https://example.com'],
    pricing: [{ capability: 'llama3', price: 5, currency: 'sats' }],
    paymentMethods: methods,
  })

describe('the rails satgate announces', () => {
  it('are all identifiers 402-announce accepts', () => {
    // Every rail this build can emit, together.
    const methods = announcedPaymentMethods(
      configWith({
        lightning: 'phoenixd',
        cashuMints: 'https://mint.example.com',
        lnurlcashMints: 'mint.example.com,other.example.com',
      }),
    )
    expect(methods.map(m => m[0])).toEqual(['l402', 'cashu', 'lnurlcash'])
    expect(() => announce(methods)).not.toThrow()
  })

  it('names the accepted mints on the lnurlcash rail', () => {
    const methods = announcedPaymentMethods(
      configWith({ lnurlcashMints: 'mint.example.com,other.example.com' }),
    )
    expect(methods).toContainEqual(['lnurlcash', 'mint.example.com', 'other.example.com'])
  })

  it('says nothing about a rail that is off, and still announces', () => {
    const methods = announcedPaymentMethods(configWith({ lightning: 'phoenixd' }))
    expect(methods.flat()).not.toContain('lnurlcash')
    expect(() => announce(methods)).not.toThrow()
  })

  it('fails loudly on a rail identifier nobody knows, which is why this file exists', () => {
    // Pinning the behaviour that made the failure total rather than partial.
    expect(() => announce([['not-a-rail', 'whatever']])).toThrow(/rail must be one of/)
  })
})
