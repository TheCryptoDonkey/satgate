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
    if (secrets.includes(credential)) {
      return { allowed: true, identity: credential.slice(0, 8) + '...' }
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
 * Stub: returns { allowed: false } until @noble/curves is wired in (Task 5).
 */
function verifyNip98(
  _base64Event: string,
  _allowlist: string[],
  _request: RequestContext,
  _now?: number,
): AllowlistResult {
  return { allowed: false }
}
