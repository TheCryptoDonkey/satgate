import { schnorr } from '@noble/curves/secp256k1.js'
import { hexToBytes } from '@noble/curves/utils.js'
import { bech32 } from '@scure/base'
import { createHash, timingSafeEqual } from 'node:crypto'

export interface AllowlistResult {
  allowed: boolean
  identity?: string
}

export interface RequestContext {
  url: string
  method: string
}

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/

/**
 * Constant-time string comparison to prevent timing attacks.
 * Handles variable-length strings safely by comparing fixed-length SHA-256 hashes.
 */
function timingSafeCompare(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest()
  const hashB = createHash('sha256').update(b).digest()
  return timingSafeEqual(hashA, hashB)
}

interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/**
 * Decode an npub (bech32-encoded) to a hex pubkey.
 */
function npubToHex(npub: string): string | null {
  try {
    const { prefix, words } = bech32.decode(npub as `${string}1${string}`)
    if (prefix !== 'npub') return null
    const bytes = bech32.fromWords(words)
    return Buffer.from(bytes).toString('hex')
  } catch {
    return null
  }
}

/**
 * Normalise allowlist entries to hex pubkeys.
 * Returns only the pubkey entries (npub or hex), not shared secrets.
 */
function extractPubkeys(allowlist: string[]): string[] {
  const pubkeys: string[] = []
  for (const entry of allowlist) {
    if (entry.startsWith('npub1')) {
      const hex = npubToHex(entry)
      if (hex) pubkeys.push(hex)
    } else if (HEX_PUBKEY_RE.test(entry)) {
      pubkeys.push(entry)
    }
  }
  return pubkeys
}

/**
 * Checks whether the Authorization header matches an entry in the allowlist.
 *
 * Identity types:
 * - Bearer <secret> — matched against non-pubkey entries (strings that are
 *   NOT 64-char hex and NOT npub1-prefixed)
 * - Nostr <base64-event> — NIP-98 verification against pubkey entries
 *
 * Security: hex pubkeys and npub entries are NEVER treated as Bearer secrets.
 * Only entries that don't look like pubkeys are valid Bearer secrets.
 */
/**
 * @param now - Optional Unix timestamp (seconds) for testing. Defaults to current time.
 */
export function checkAllowlist(
  authHeader: string | undefined,
  allowlist: string[],
  request: RequestContext,
  now?: number,
): AllowlistResult {
  if (!authHeader || allowlist.length === 0) {
    return { allowed: false }
  }

  const spaceIdx = authHeader.indexOf(' ')
  if (spaceIdx === -1) return { allowed: false }

  const scheme = authHeader.slice(0, spaceIdx)
  const credential = authHeader.slice(spaceIdx + 1)

  if (scheme === 'Bearer') {
    // Only match entries that are NOT pubkeys (hex or npub)
    const secrets = allowlist.filter(
      entry => !entry.startsWith('npub1') && !HEX_PUBKEY_RE.test(entry),
    )
    for (const secret of secrets) {
      if (timingSafeCompare(credential, secret)) {
        return { allowed: true, identity: credential.slice(0, 8) + '...' }
      }
    }
    return { allowed: false }
  }

  if (scheme === 'Nostr') {
    return verifyNip98(credential, allowlist, request, now)
  }

  return { allowed: false }
}

/**
 * Verify a NIP-98 HTTP Auth event against the allowlist of pubkeys.
 */
function verifyNip98(
  base64Event: string,
  allowlist: string[],
  request: RequestContext,
  nowOverride?: number,
): AllowlistResult {
  try {
    const json = Buffer.from(base64Event, 'base64').toString('utf-8')
    const event: NostrEvent = JSON.parse(json)

    // Must be kind 27235 (NIP-98 HTTP Auth)
    if (event.kind !== 27235) return { allowed: false }

    // Check created_at is within 60 seconds (injectable for testing)
    const now = nowOverride ?? Math.floor(Date.now() / 1000)
    if (Math.abs(now - event.created_at) > 60) return { allowed: false }

    // Validate URL and method tags match the actual request
    const urlTag = event.tags.find(t => t[0] === 'u')?.[1]
    const methodTag = event.tags.find(t => t[0] === 'method')?.[1]
    if (urlTag !== request.url) return { allowed: false }
    if (methodTag?.toUpperCase() !== request.method.toUpperCase()) return { allowed: false }

    // Verify event ID
    const serialised = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
    const expectedId = createHash('sha256').update(serialised).digest('hex')
    if (event.id !== expectedId) return { allowed: false }

    // Verify schnorr signature
    const valid = schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey))
    if (!valid) return { allowed: false }

    // Check pubkey against allowlist (normalise npub → hex)
    const allowedPubkeys = extractPubkeys(allowlist)
    if (allowedPubkeys.includes(event.pubkey)) {
      return { allowed: true, identity: event.pubkey.slice(0, 8) + '...' }
    }

    return { allowed: false }
  } catch {
    return { allowed: false }
  }
}
