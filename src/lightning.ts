import type { LightningBackend } from '@thecryptodonkey/toll-booth'
import {
  phoenixdBackend,
  lnbitsBackend,
  lndBackend,
  clnBackend,
} from '@thecryptodonkey/toll-booth'

export interface LightningConfig {
  lightning?: string
  lightningUrl?: string
  lightningKey?: string
}

const HEX_RE = /^[0-9a-fA-F]+$/

/**
 * Creates a Lightning backend from CLI/config options.
 * Returns undefined if no backend is configured.
 */
export function createLightningBackend(config: LightningConfig): LightningBackend | undefined {
  if (!config.lightning) return undefined

  if (!config.lightningKey) {
    throw new Error('--lightning-key is required when --lightning is set')
  }

  if (!config.lightningUrl) {
    throw new Error('--lightning-url is required when --lightning is set')
  }

  const url = config.lightningUrl

  switch (config.lightning) {
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
