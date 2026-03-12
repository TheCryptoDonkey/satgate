import { describe, it, expect } from 'vitest'
import { checkAllowlist } from './allowlist.js'
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

describe('NIP-98 allowlist', () => {
  const url = 'http://localhost:3000/v1/chat/completions'
  const method = 'POST'
  const now = Math.floor(Date.now() / 1000)

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
})
