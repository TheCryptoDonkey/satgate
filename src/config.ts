import { randomBytes } from 'node:crypto'
import { resolve, relative } from 'node:path'
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
  try {
    const parsed = new URL(upstream)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('upstream URL must use http or https')
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('http or https')) throw e
    throw new Error(`upstream URL is not a valid URL: ${upstream}`)
  }

  const portRaw = args.port ?? (env.PORT ? parseInt(env.PORT, 10) : undefined) ?? file.port ?? 3000
  if (!Number.isFinite(portRaw) || portRaw < 0 || portRaw > 65535) {
    throw new Error(`Invalid port: ${portRaw} (must be 0–65535)`)
  }
  const port = portRaw

  const rootKeyRaw = args.rootKey ?? env.ROOT_KEY ?? file.rootKey
  const rootKeyGenerated = !rootKeyRaw
  const rootKey = rootKeyRaw ?? randomBytes(32).toString('hex')

  const storageRaw = args.storage ?? env.STORAGE ?? file.storage ?? 'memory'
  if (storageRaw !== 'memory' && storageRaw !== 'sqlite') {
    throw new Error(`Invalid storage type: ${storageRaw} (must be 'memory' or 'sqlite')`)
  }
  const storage = storageRaw as 'memory' | 'sqlite'

  const dbPathRaw = args.dbPath ?? env.TOKEN_TOLL_DB_PATH ?? file.dbPath ?? './token-toll.db'
  const resolvedDbPath = resolve(dbPathRaw)
  const relFromCwd = relative(process.cwd(), resolvedDbPath)
  if (relFromCwd.startsWith('..')) {
    throw new Error(`dbPath must be within the working directory (got: ${dbPathRaw})`)
  }
  const dbPath = dbPathRaw

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
  if (flatPrice !== undefined && (!Number.isFinite(flatPrice) || flatPrice < 0)) {
    throw new Error(`Invalid price: ${flatPrice} (must be a non-negative number)`)
  }
  const hasPricingConfig = file.pricing !== undefined
  const flatPricing = flatPrice !== undefined || !hasPricingConfig
  const price = flatPrice ?? 1

  const freeTierRequests = args.freeTier
    ?? (env.FREE_TIER_REQUESTS ? parseInt(env.FREE_TIER_REQUESTS, 10) : undefined)
    ?? file.freeTier?.requestsPerDay
    ?? 0
  if (!Number.isFinite(freeTierRequests) || freeTierRequests < 0) {
    throw new Error(`Invalid free tier value: ${freeTierRequests} (must be a non-negative integer)`)
  }

  const maxConcurrent = args.maxConcurrent
    ?? (env.MAX_CONCURRENT ? parseInt(env.MAX_CONCURRENT, 10) : undefined)
    ?? file.capacity?.maxConcurrent
    ?? 0
  if (!Number.isFinite(maxConcurrent) || maxConcurrent < 0) {
    throw new Error(`Invalid max concurrent value: ${maxConcurrent} (must be a non-negative integer)`)
  }

  const trustProxy = args.trustProxy !== undefined
    ? args.trustProxy
    : env.TRUST_PROXY !== undefined
      ? env.TRUST_PROXY === 'true'
      : file.trustProxy ?? false

  const tiers = file.tiers ?? []

  const estimatedCostSats = file.estimatedCostSats ?? Math.max(pricingDefault * 10, 10)
  const maxBodySize = file.maxBodySize ?? 10 * 1024 * 1024 // 10 MiB

  // Lightning backend config
  const VALID_BACKENDS = ['phoenixd', 'lnbits', 'lnd', 'cln'] as const
  const lightningRaw = args.lightning ?? env.LIGHTNING_BACKEND ?? file.lightning
  if (lightningRaw && !VALID_BACKENDS.includes(lightningRaw as any)) {
    throw new Error(`Invalid lightning backend: ${lightningRaw} (must be one of: ${VALID_BACKENDS.join(', ')})`)
  }
  const lightning = lightningRaw as TokenTollConfig['lightning']
  const lightningUrl = args.lightningUrl ?? env.LIGHTNING_URL ?? file.lightningUrl
    ?? (lightning ? LIGHTNING_URL_DEFAULTS[lightning] : undefined)
  if (lightningUrl) {
    try {
      const parsed = new URL(lightningUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('lightning URL must use http or https')
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('http or https')) throw e
      throw new Error(`lightning URL is not a valid URL: ${lightningUrl}`)
    }
  }
  const lightningKey = args.lightningKey ?? env.LIGHTNING_KEY ?? file.lightningKey

  // Auth mode inference
  const VALID_AUTH_MODES = ['open', 'lightning', 'allowlist'] as const
  const explicitAuth = args.authMode ?? env.AUTH_MODE ?? file.auth
  if (explicitAuth && !VALID_AUTH_MODES.includes(explicitAuth as any)) {
    throw new Error(`Invalid auth mode: ${explicitAuth} (must be one of: ${VALID_AUTH_MODES.join(', ')})`)
  }
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
