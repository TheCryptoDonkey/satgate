import { randomBytes } from 'node:crypto'
import type { LightningBackend } from '@thecryptodonkey/toll-booth'

export interface ModelPricing {
  /** Sats per 1k tokens for each model. */
  models: Record<string, number>
  /** Default sats per 1k tokens for unlisted models. */
  default: number
}

export interface TokenTollConfig {
  upstream: string
  port: number
  rootKey: string
  rootKeyGenerated: boolean
  storage: 'memory' | 'sqlite'
  dbPath: string
  pricing: ModelPricing
  freeTier: { requestsPerDay: number }
  capacity: { maxConcurrent: number }
  tiers: Array<{ amountSats: number; creditSats: number; label: string }>
  trustProxy: boolean
  /** Estimated cost in sats to hold per request (deducted upfront, reconciled after). */
  estimatedCostSats: number
  /** Maximum request body size in bytes. */
  maxBodySize: number
  /** Auto-detected model IDs from upstream. */
  models?: string[]
  // New fields:
  lightning?: 'phoenixd' | 'lnbits' | 'lnd' | 'cln'
  lightningUrl?: string
  lightningKey?: string
  authMode: 'open' | 'lightning' | 'allowlist'
  allowlist: string[]
  flatPricing: boolean
  /** Flat per-request price in sats (only used when flatPricing is true). */
  price: number
  tunnel: boolean
  /** Lightning backend instance (created externally, threaded to server). */
  backend?: LightningBackend
}

export interface CliArgs {
  upstream?: string
  port?: number
  config?: string
  price?: number
  maxConcurrent?: number
  storage?: string
  dbPath?: string
  freeTier?: number
  trustProxy?: boolean
  rootKey?: string
  // New fields:
  lightning?: string
  lightningUrl?: string
  lightningKey?: string
  authMode?: string
  allowlist?: string[]
  allowlistFile?: string
  noTunnel?: boolean
}

export interface FileConfig {
  upstream?: string
  port?: number
  rootKey?: string
  storage?: string
  dbPath?: string
  pricing?: { default?: number; models?: Record<string, number> }
  freeTier?: { requestsPerDay?: number }
  capacity?: { maxConcurrent?: number }
  tiers?: Array<{ amountSats: number; creditSats: number; label: string }>
  trustProxy?: boolean
  estimatedCostSats?: number
  maxBodySize?: number
  // New fields:
  lightning?: string
  lightningUrl?: string
  lightningKey?: string
  auth?: string
  allowlist?: string[]
  price?: number
  tunnel?: boolean
}

const LIGHTNING_URL_DEFAULTS: Record<string, string> = {
  phoenixd: 'http://localhost:9740',
  lnbits: 'https://legend.lnbits.com',
  lnd: 'https://localhost:8080',
  cln: 'http://localhost:3010',
}

/**
 * Loads and validates configuration.
 * Precedence: CLI args > env vars > config file > defaults.
 */
export function loadConfig(
  args: CliArgs,
  env: Record<string, string | undefined> = {},
  file: FileConfig = {},
): TokenTollConfig {
  const upstream = args.upstream ?? env.UPSTREAM_URL ?? file.upstream
  if (!upstream) {
    throw new Error('upstream URL is required (--upstream or UPSTREAM_URL)')
  }

  const port = args.port ?? (env.PORT ? parseInt(env.PORT, 10) : undefined) ?? file.port ?? 3000

  const rootKeyRaw = args.rootKey ?? env.ROOT_KEY ?? file.rootKey
  const rootKeyGenerated = !rootKeyRaw
  const rootKey = rootKeyRaw ?? randomBytes(32).toString('hex')

  const storage = (args.storage ?? env.STORAGE ?? file.storage ?? 'memory') as 'memory' | 'sqlite'
  const dbPath = args.dbPath ?? env.TOKEN_TOLL_DB_PATH ?? file.dbPath ?? './token-toll.db'

  // Pricing: two separate concerns
  // 1. pricing.default / pricing.models — per-token pricing (config file users)
  // 2. config.price / config.flatPricing — flat per-request pricing (CLI quick-start)
  //
  // args.price means flat per-request price, NOT pricing.default.
  // pricing.default comes only from env.DEFAULT_PRICE or file pricing.default.
  const pricingDefault = (env.DEFAULT_PRICE ? parseInt(env.DEFAULT_PRICE, 10) : undefined)
    ?? file.pricing?.default
    ?? 1

  const pricing: ModelPricing = {
    default: pricingDefault,
    models: file.pricing?.models ?? {},
  }

  // Flat pricing determination
  // Flat mode activates when: (a) explicit --price / file.price is set, OR
  // (b) no pricing config exists at all (quick-start default).
  // Any file `pricing` block (even just `pricing.default`) opts into per-token mode.
  const flatPrice = args.price ?? file.price
  const hasPricingConfig = file.pricing !== undefined
  const flatPricing = flatPrice !== undefined || !hasPricingConfig
  const price = flatPrice ?? 1

  const freeTierRequests = args.freeTier
    ?? (env.FREE_TIER_REQUESTS ? parseInt(env.FREE_TIER_REQUESTS, 10) : undefined)
    ?? file.freeTier?.requestsPerDay
    ?? 0

  const maxConcurrent = args.maxConcurrent
    ?? (env.MAX_CONCURRENT ? parseInt(env.MAX_CONCURRENT, 10) : undefined)
    ?? file.capacity?.maxConcurrent
    ?? 0

  const trustProxy = args.trustProxy !== undefined
    ? args.trustProxy
    : env.TRUST_PROXY !== undefined
      ? env.TRUST_PROXY === 'true'
      : file.trustProxy ?? false

  const tiers = file.tiers ?? []

  const estimatedCostSats = file.estimatedCostSats ?? Math.max(pricingDefault * 10, 10)
  const maxBodySize = file.maxBodySize ?? 10 * 1024 * 1024 // 10 MiB

  // Lightning backend config
  const lightning = (args.lightning ?? env.LIGHTNING_BACKEND ?? file.lightning) as TokenTollConfig['lightning']
  const lightningUrl = args.lightningUrl ?? env.LIGHTNING_URL ?? file.lightningUrl
    ?? (lightning ? LIGHTNING_URL_DEFAULTS[lightning] : undefined)
  const lightningKey = args.lightningKey ?? env.LIGHTNING_KEY ?? file.lightningKey

  // Auth mode inference
  const explicitAuth = args.authMode ?? env.AUTH_MODE ?? file.auth
  let authMode: TokenTollConfig['authMode']
  if (explicitAuth) {
    authMode = explicitAuth as TokenTollConfig['authMode']
    if (authMode === 'lightning' && !lightning) {
      throw new Error("auth mode 'lightning' requires --lightning <backend>")
    }
  } else {
    authMode = lightning ? 'lightning' : 'open'
  }

  // Allowlist
  const allowlist = args.allowlist ?? file.allowlist ?? []
  if (authMode === 'allowlist' && allowlist.length === 0) {
    throw new Error("auth mode 'allowlist' requires --allowlist <keys> or --allowlist-file <path>")
  }

  // Tunnel
  const tunnelEnv = env.TUNNEL !== undefined ? env.TUNNEL !== 'false' : undefined
  const tunnel = args.noTunnel === true ? false : (tunnelEnv ?? file.tunnel ?? true)

  // Validate numeric ranges
  if (!Number.isFinite(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${port} (must be 0–65535)`)
  }
  if (!Number.isFinite(price) || price < 0) {
    throw new Error(`Invalid price: ${price} (must be non-negative)`)
  }
  if (!Number.isFinite(pricingDefault) || pricingDefault < 0) {
    throw new Error(`Invalid pricing default: ${pricingDefault} (must be non-negative)`)
  }
  if (!Number.isFinite(maxConcurrent) || maxConcurrent < 0) {
    throw new Error(`Invalid max-concurrent: ${maxConcurrent} (must be non-negative)`)
  }
  if (!Number.isFinite(freeTierRequests) || freeTierRequests < 0) {
    throw new Error(`Invalid free-tier: ${freeTierRequests} (must be non-negative)`)
  }

  return {
    upstream: upstream.replace(/\/+$/, ''),
    port,
    rootKey,
    rootKeyGenerated,
    storage,
    dbPath,
    pricing,
    freeTier: { requestsPerDay: freeTierRequests },
    capacity: { maxConcurrent },
    tiers,
    trustProxy,
    estimatedCostSats,
    maxBodySize,
    lightning,
    lightningUrl,
    lightningKey,
    authMode,
    allowlist,
    flatPricing,
    price,
    tunnel,
  }
}
