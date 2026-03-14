import { describe, it, expect, beforeEach } from 'vitest'
import { checkAllowlist, _resetSeenIds } from './allowlist.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js'
import { bech32 } from '@scure/base'
import { createHash } from 'node:crypto'

function hexToNpub(hex: string): string {
  const words = bech32.toWords(Buffer.from(hex, 'hex'))
  return bech32.encode('npub', words)
}

function createNip98Token(privateKey: Uint8Array, url: string, method: string, createdAt?: number): string {
  const pubkey = bytesToHex(schnorr.getPublicKey(privateKey))
  const event = {
    pubkey,
    created_at: createdAt ?? Math.floor(Date.now() / 1000),
    kind: 27235,
    tags: [['u', url], ['method', method]],
    content: '',
  }
  const serialised = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
  const id = createHash('sha256').update(serialised).digest('hex')
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), privateKey))
  return btoa(JSON.stringify({ ...event, id, sig }))
}

describe('checkAllowlist', () => {
  // Use secrets that cannot be confused with hex pubkeys (64-char hex)
  const secrets = ['secret-abc', 'secret-xyz']

  it('allows request with valid Bearer secret', () => {
    const result = checkAllowlist('Bearer secret-abc', secrets, { url: '', method: '' })
    expect(result.allowed).toBe(true)
  })

  it('rejects request with invalid Bearer secret', () => {
    const result = checkAllowlist('Bearer wrong-secret', secrets, { url: '', method: '' })
    expect(result.allowed).toBe(false)
  })

  it('rejects request with no auth header', () => {
    const result = checkAllowlist(undefined, secrets, { url: '', method: '' })
    expect(result.allowed).toBe(false)
  })

  it('rejects request with non-Bearer/non-Nostr scheme', () => {
    const result = checkAllowlist('Basic dXNlcjpwYXNz', secrets, { url: '', method: '' })
    expect(result.allowed).toBe(false)
  })

  it('handles empty allowlist', () => {
    const result = checkAllowlist('Bearer anything', [], { url: '', method: '' })
    expect(result.allowed).toBe(false)
  })

  it('does not treat hex pubkeys as Bearer secrets', () => {
    // A 64-char hex string in the allowlist should NOT match as a Bearer secret
    const hexPubkey = 'a'.repeat(64)
    const result = checkAllowlist(`Bearer ${hexPubkey}`, [hexPubkey], { url: '', method: '' })
    expect(result.allowed).toBe(false)
  })
})

describe('timing-safe Bearer comparison', () => {
  it('allows valid secret with timing-safe comparison', () => {
    const result = checkAllowlist('Bearer my-secret-key', ['my-secret-key'], { url: '', method: '' })
    expect(result.allowed).toBe(true)
  })

  it('rejects similar but different secret', () => {
    const result = checkAllowlist('Bearer my-secret-kex', ['my-secret-key'], { url: '', method: '' })
    expect(result.allowed).toBe(false)
  })

  it('rejects secret that is a prefix of the allowlist entry', () => {
    const result = checkAllowlist('Bearer my-secret', ['my-secret-key'], { url: '', method: '' })
    expect(result.allowed).toBe(false)
  })

  it('rejects secret that is a superstring of the allowlist entry', () => {
    const result = checkAllowlist('Bearer my-secret-key-extra', ['my-secret-key'], { url: '', method: '' })
    expect(result.allowed).toBe(false)
  })

  it('matches correct secret among multiple entries', () => {
    const allowlist = ['secret-one', 'secret-two', 'secret-three']
    const result = checkAllowlist('Bearer secret-two', allowlist, { url: '', method: '' })
    expect(result.allowed).toBe(true)
    expect(result.identity).toBe('secret-t...')
  })
})

describe('NIP-98 allowlist', () => {
  const url = 'http://localhost:3000/v1/chat/completions'
  const method = 'POST'
  const now = Math.floor(Date.now() / 1000)

  beforeEach(() => {
    _resetSeenIds()
  })

  it('allows request with valid NIP-98 event from allowlisted hex pubkey', () => {
    const privKey = schnorr.utils.randomSecretKey()
    const pubkey = bytesToHex(schnorr.getPublicKey(privKey))
    const token = createNip98Token(privKey, url, method, now)

    const result = checkAllowlist(`Nostr ${token}`, [pubkey], { url, method }, now)
    expect(result.allowed).toBe(true)
  })

  it('allows request with valid NIP-98 event from allowlisted npub', () => {
    const privKey = schnorr.utils.randomSecretKey()
    const pubkey = bytesToHex(schnorr.getPublicKey(privKey))
    const npub = hexToNpub(pubkey)
    const token = createNip98Token(privKey, url, method, now)

    const result = checkAllowlist(`Nostr ${token}`, [npub], { url, method }, now)
    expect(result.allowed).toBe(true)
  })

  it('rejects NIP-98 event from non-allowlisted pubkey', () => {
    const privKey = schnorr.utils.randomSecretKey()
    const token = createNip98Token(privKey, url, method, now)
    const otherPubkey = bytesToHex(schnorr.getPublicKey(schnorr.utils.randomSecretKey()))

    const result = checkAllowlist(`Nostr ${token}`, [otherPubkey], { url, method }, now)
    expect(result.allowed).toBe(false)
  })

  it('rejects NIP-98 event with wrong URL', () => {
    const privKey = schnorr.utils.randomSecretKey()
    const pubkey = bytesToHex(schnorr.getPublicKey(privKey))
    const token = createNip98Token(privKey, 'http://evil.com/v1/chat/completions', method, now)

    const result = checkAllowlist(`Nostr ${token}`, [pubkey], { url, method }, now)
    expect(result.allowed).toBe(false)
  })

  it('rejects NIP-98 event with wrong method', () => {
    const privKey = schnorr.utils.randomSecretKey()
    const pubkey = bytesToHex(schnorr.getPublicKey(privKey))
    const token = createNip98Token(privKey, url, 'GET', now)

    const result = checkAllowlist(`Nostr ${token}`, [pubkey], { url, method }, now)
    expect(result.allowed).toBe(false)
  })

  it('rejects NIP-98 event with expired timestamp', () => {
    const privKey = schnorr.utils.randomSecretKey()
    const pubkey = bytesToHex(schnorr.getPublicKey(privKey))
    const expired = now - 120  // 2 minutes before `now`
    const token = createNip98Token(privKey, url, method, expired)

    const result = checkAllowlist(`Nostr ${token}`, [pubkey], { url, method }, now)
    expect(result.allowed).toBe(false)
  })

  it('rejects malformed NIP-98 event', () => {
    const result = checkAllowlist(`Nostr ${btoa('not json')}`, ['a'.repeat(64)], { url, method }, now)
    expect(result.allowed).toBe(false)
  })

  it('rejects NIP-98 with invalid base64', () => {
    const result = checkAllowlist('Nostr !!!invalid!!!', ['a'.repeat(64)], { url, method }, now)
    expect(result.allowed).toBe(false)
  })

  it('rejects NIP-98 event with tampered signature', () => {
    const privKey = schnorr.utils.randomSecretKey()
    const pubkey = bytesToHex(schnorr.getPublicKey(privKey))
    const token = createNip98Token(privKey, url, method, now)
    const decoded = JSON.parse(atob(token))
    // Flip a byte in the signature
    decoded.sig = 'ff' + decoded.sig.slice(2)
    const tampered = btoa(JSON.stringify(decoded))

    const result = checkAllowlist(`Nostr ${tampered}`, [pubkey], { url, method }, now)
    expect(result.allowed).toBe(false)
  })

  it('rejects NIP-98 event with tampered id', () => {
    const privKey = schnorr.utils.randomSecretKey()
    const pubkey = bytesToHex(schnorr.getPublicKey(privKey))
    const token = createNip98Token(privKey, url, method, now)
    const decoded = JSON.parse(atob(token))
    // Tamper with the id
    decoded.id = 'ff' + decoded.id.slice(2)
    const tampered = btoa(JSON.stringify(decoded))

    const result = checkAllowlist(`Nostr ${tampered}`, [pubkey], { url, method }, now)
    expect(result.allowed).toBe(false)
  })

  it('rejects NIP-98 event with wrong kind', () => {
    const privKey = schnorr.utils.randomSecretKey()
    const pubkey = bytesToHex(schnorr.getPublicKey(privKey))
    // Build event with wrong kind
    const event = {
      pubkey,
      created_at: now,
      kind: 1, // not 27235
      tags: [['u', url], ['method', method]],
      content: '',
    }
    const serialised = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
    const id = createHash('sha256').update(serialised).digest('hex')
    const sig = bytesToHex(schnorr.sign(hexToBytes(id), privKey))
    const token = btoa(JSON.stringify({ ...event, id, sig }))

    const result = checkAllowlist(`Nostr ${token}`, [pubkey], { url, method }, now)
    expect(result.allowed).toBe(false)
  })

  it('rejects NIP-98 event with missing u tag', () => {
    const privKey = schnorr.utils.randomSecretKey()
    const pubkey = bytesToHex(schnorr.getPublicKey(privKey))
    const event = {
      pubkey,
      created_at: now,
      kind: 27235,
      tags: [['method', method]], // no 'u' tag
      content: '',
    }
    const serialised = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
    const id = createHash('sha256').update(serialised).digest('hex')
    const sig = bytesToHex(schnorr.sign(hexToBytes(id), privKey))
    const token = btoa(JSON.stringify({ ...event, id, sig }))

    const result = checkAllowlist(`Nostr ${token}`, [pubkey], { url, method }, now)
    expect(result.allowed).toBe(false)
  })

  it('rejects NIP-98 event with missing method tag', () => {
    const privKey = schnorr.utils.randomSecretKey()
    const pubkey = bytesToHex(schnorr.getPublicKey(privKey))
    const event = {
      pubkey,
      created_at: now,
      kind: 27235,
      tags: [['u', url]], // no 'method' tag
      content: '',
    }
    const serialised = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
    const id = createHash('sha256').update(serialised).digest('hex')
    const sig = bytesToHex(schnorr.sign(hexToBytes(id), privKey))
    const token = btoa(JSON.stringify({ ...event, id, sig }))

    const result = checkAllowlist(`Nostr ${token}`, [pubkey], { url, method }, now)
    expect(result.allowed).toBe(false)
  })

  it('uses timing-safe comparison for Bearer tokens', () => {
    // This test verifies the function works correctly — timing safety
    // is ensured by the implementation using crypto.timingSafeEqual
    const secrets = ['my-secret-token-abc']
    const allowed = checkAllowlist('Bearer my-secret-token-abc', secrets, { url: '', method: '' })
    expect(allowed.allowed).toBe(true)
    const denied = checkAllowlist('Bearer my-secret-token-abd', secrets, { url: '', method: '' })
    expect(denied.allowed).toBe(false)
  })

  it('rejects replayed NIP-98 event (same event ID used twice)', () => {
    const privKey = schnorr.utils.randomSecretKey()
    const pubkey = bytesToHex(schnorr.getPublicKey(privKey))
    const token = createNip98Token(privKey, url, method, now)

    const first = checkAllowlist(`Nostr ${token}`, [pubkey], { url, method }, now)
    expect(first.allowed).toBe(true)

    const replay = checkAllowlist(`Nostr ${token}`, [pubkey], { url, method }, now)
    expect(replay.allowed).toBe(false)
  })
})

describe('upper-case hex pubkey handling', () => {
  it('does not treat upper-case hex pubkeys as Bearer secrets', () => {
    const upperHex = 'A'.repeat(64)
    const result = checkAllowlist(`Bearer ${upperHex}`, [upperHex], { url: '', method: '' })
    expect(result.allowed).toBe(false)
  })

  it('does not treat mixed-case hex pubkeys as Bearer secrets', () => {
    const mixedHex = 'aAbBcCdDeEfF' + '0'.repeat(52)
    const result = checkAllowlist(`Bearer ${mixedHex}`, [mixedHex], { url: '', method: '' })
    expect(result.allowed).toBe(false)
  })
})
