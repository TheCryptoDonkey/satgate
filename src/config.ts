import { randomBytes } from 'node:crypto'

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

  const pricingDefault = args.price
    ?? (env.DEFAULT_PRICE ? parseInt(env.DEFAULT_PRICE, 10) : undefined)
    ?? file.pricing?.default
    ?? 1

  const pricing: ModelPricing = {
    default: pricingDefault,
    models: file.pricing?.models ?? {},
  }

  const freeTierRequests = args.freeTier
    ?? (env.FREE_TIER_REQUESTS ? parseInt(env.FREE_TIER_REQUESTS, 10) : undefined)
    ?? file.freeTier?.requestsPerDay
    ?? 0

  const maxConcurrent = args.maxConcurrent
    ?? (env.MAX_CONCURRENT ? parseInt(env.MAX_CONCURRENT, 10) : undefined)
    ?? file.capacity?.maxConcurrent
    ?? 0

  const trustProxy = args.trustProxy
    ?? (env.TRUST_PROXY === 'true')
    ?? file.trustProxy
    ?? false

  const tiers = file.tiers ?? []

  const estimatedCostSats = file.estimatedCostSats ?? Math.max(pricingDefault * 10, 10)
  const maxBodySize = file.maxBodySize ?? 10 * 1024 * 1024 // 10 MiB

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
  }
}
