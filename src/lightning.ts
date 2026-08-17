import { readFileSync } from 'node:fs'
import type { LightningBackend } from '@forgesworn/toll-booth'
import {
  phoenixdBackend,
  lnbitsBackend,
  lndBackend,
  clnBackend,
  nwcBackend,
} from '@forgesworn/toll-booth'

export interface LightningConfig {
  lightning?: string
  lightningUrl?: string
  lightningKey?: string
}

const HEX_RE = /^[0-9a-fA-F]+$/
const NWC_URI_RE = /^nostr\+walletconnect:\/\//i

/**
 * Resolves an NWC connection URI from either an inline value or a file path.
 * Reading from a file is preferred; see the note at the call site.
 */
function readNwcUri(keyOrPath: string): string {
  if (NWC_URI_RE.test(keyOrPath)) return keyOrPath

  let contents: string
  try {
    contents = readFileSync(keyOrPath, 'utf8').trim()
  } catch {
    // Never include the value in the message: if it was an inline URI that
    // failed the pattern test, echoing it would leak the secret into logs.
    throw new Error(
      '--lightning-key for nwc must be a nostr+walletconnect:// URI or a readable file containing one',
    )
  }
  if (!NWC_URI_RE.test(contents)) {
    throw new Error(`file ${keyOrPath} does not contain a nostr+walletconnect:// URI`)
  }
  return contents
}

/**
 * Creates a Lightning backend from CLI/config options.
 * Returns undefined if no backend is configured.
 */
export function createLightningBackend(config: LightningConfig): LightningBackend | undefined {
  if (!config.lightning) return undefined

  if (!config.lightningKey) {
    throw new Error('--lightning-key is required when --lightning is set')
  }

  // NWC carries its relay inside the connection URI, so there is no separate
  // endpoint to configure. Every other backend needs one.
  if (config.lightning !== 'nwc' && !config.lightningUrl) {
    throw new Error('--lightning-url is required when --lightning is set')
  }

  const url = config.lightningUrl!

  switch (config.lightning) {
    case 'nwc':
      // A NIP-47 URI is a bearer credential: whatever it permits, its holder can
      // do. Prefer a file path, so it stays out of shell history and the process
      // table, exactly as 402-mcp treats NWC_URI_FILE. An inline URI is accepted
      // because a container without a mounted secret has nowhere else to put it.
      return nwcBackend({ nwcUrl: readNwcUri(config.lightningKey) })

    case 'phoenixd':
      return phoenixdBackend({ url, password: config.lightningKey })

    case 'lnbits':
      return lnbitsBackend({ url, apiKey: config.lightningKey })

    case 'lnd': {
      // Hex string = inline macaroon, otherwise = file path
      const isHex = HEX_RE.test(config.lightningKey)
      return lndBackend({
        url,
        ...(isHex
          ? { macaroon: config.lightningKey }
          : { macaroonPath: config.lightningKey }),
      })
    }

    case 'cln':
      return clnBackend({ url, rune: config.lightningKey })

    default:
      throw new Error(`Unknown lightning backend: ${config.lightning}`)
  }
}
