import { schnorr } from '@noble/curves/secp256k1.js'
import { hexToBytes } from '@noble/curves/utils.js'
import { bech32 } from '@scure/base'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export interface AllowlistResult {
  allowed: boolean
  identity?: string
}

export interface RequestContext {
  url: string
  method: string
}

const HEX_PUBKEY_RE = /^[0-9a-fA-F]{64}$/

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
      pubkeys.push(entry.toLowerCase())
    }
  }
  return pubkeys
}

/** HMAC key used to normalise inputs to a fixed length before comparison. */
const HMAC_KEY = createHash('sha256').update('satgate-bearer-compare').digest()

/**
 * Constant-time string comparison using HMAC to normalise to fixed length.
 * This prevents leaking input length via timing side-channels.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const hmacA = createHmac('sha256', HMAC_KEY).update(a).digest()
  const hmacB = createHmac('sha256', HMAC_KEY).update(b).digest()
  return timingSafeEqual(hmacA, hmacB)
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
    // Check all entries to avoid leaking which position matched via timing
    let matched = false
    for (const s of secrets) {
      if (constantTimeEqual(s, credential)) matched = true
    }
    if (matched) {
      // Use hash-derived identifier to avoid leaking secret material in logs
      const idHash = createHash('sha256').update(credential).digest('hex').slice(0, 8)
      return { allowed: true, identity: idHash + '...' }
    }
    return { allowed: false }
  }

  if (scheme === 'Nostr') {
    return verifyNip98(credential, allowlist, request, now)
  }

  return { allowed: false }
}

/**
 * Short-lived cache of seen NIP-98 event IDs to prevent replay attacks.
 * Entries expire after 120s (twice the 60s acceptance window).
 */
const seenEventIds = new Map<string, number>()
const SEEN_ID_TTL_MS = 120_000
const SEEN_ID_MAX_SIZE = 10_000

function pruneSeenIds(): void {
  const cutoff = Date.now() - SEEN_ID_TTL_MS
  for (const [id, ts] of seenEventIds) {
    if (ts < cutoff) seenEventIds.delete(id)
  }
}

/** Exported for testing — clears the seen-ID cache. */
export function _resetSeenIds(): void {
  seenEventIds.clear()
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

    // Reject replayed event IDs
    if (seenEventIds.has(event.id)) return { allowed: false }
    if (seenEventIds.size >= SEEN_ID_MAX_SIZE) {
      pruneSeenIds()
      // If still at capacity after pruning, evict oldest entries to make room
      if (seenEventIds.size >= SEEN_ID_MAX_SIZE) {
        const entriesToEvict = Math.max(1, Math.floor(SEEN_ID_MAX_SIZE * 0.1))
        const iter = seenEventIds.keys()
        for (let i = 0; i < entriesToEvict; i++) {
          const key = iter.next().value
          if (key !== undefined) seenEventIds.delete(key)
        }
      }
    }

    // Validate URL and method tags match the actual request
    const urlTag = event.tags.find(t => t[0] === 'u')?.[1]
    const methodTag = event.tags.find(t => t[0] === 'method')?.[1]
    if (urlTag !== request.url) return { allowed: false }
    if (methodTag?.toUpperCase() !== request.method.toUpperCase()) return { allowed: false }

    // Validate hex field formats before expensive crypto operations
    const HEX_64 = /^[0-9a-fA-F]{64}$/
    const HEX_128 = /^[0-9a-fA-F]{128}$/
    if (!HEX_64.test(event.pubkey) || !HEX_64.test(event.id) || !HEX_128.test(event.sig)) {
      return { allowed: false }
    }

    // Verify event ID
    const serialised = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
    const expectedId = createHash('sha256').update(serialised).digest('hex')
    if (event.id !== expectedId) return { allowed: false }

    // Verify schnorr signature
    const valid = schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey))
    if (!valid) return { allowed: false }

    // Check pubkey against allowlist (normalise npub → hex, case-insensitive)
    const allowedPubkeys = extractPubkeys(allowlist)
    if (allowedPubkeys.includes(event.pubkey.toLowerCase())) {
      seenEventIds.set(event.id, Date.now())
      return { allowed: true, identity: event.pubkey.slice(0, 8) + '...' }
    }

    return { allowed: false }
  } catch {
    return { allowed: false }
  }
}
