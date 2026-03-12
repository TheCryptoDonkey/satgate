import { describe, it, expect } from 'vitest'
import { checkAllowlist } from './allowlist.js'

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
