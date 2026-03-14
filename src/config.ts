import { randomBytes } from 'node:crypto'
import { resolve, relative } from 'node:path'
import type { LightningBackend } from '@thecryptodonkey/toll-booth'
import type { Logger } from './logger.js'

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
  freeTier: { creditsPerDay: number }
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
  x402?: {
    receiverAddress: string
    network: string
    facilitatorUrl?: string
    facilitatorKey?: string
    asset?: string
    creditMode?: boolean
  }
  defaultPriceUsd?: number
  verbose: boolean
  logFormat: 'pretty' | 'json'
  logger?: Logger
  /** Human-readable service name for Lightning invoice descriptions. Defaults to 'toll-booth'. */
  serviceName?: string
  /** Announce service on Nostr relays for discovery. */
  announce: boolean
  /** Nostr relay URLs for service announcement. */
  announceRelays: string[]
  /** Hex Nostr secret key for signing announcements. */
  announceKey: string
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
  verbose?: boolean
  logFormat?: string
  tokenPrice?: number
  modelPrice?: string[]
  announce?: boolean
  announceRelays?: string
  announceKey?: string
}

export interface FileConfig {
  upstream?: string
  port?: number
  rootKey?: string
  storage?: string
  dbPath?: string
  pricing?: { default?: number; models?: Record<string, number> }
  freeTier?: { creditsPerDay?: number; requestsPerDay?: number }
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
  x402?: {
    receiverAddress?: string
    network?: string
    facilitatorUrl?: string
    facilitatorKey?: string
    asset?: string
    creditMode?: boolean
  }
  defaultPriceUsd?: number
  verbose?: boolean
  logFormat?: string
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
  if (rootKeyRaw && rootKeyRaw.length < 32) {
    throw new Error('rootKey must be at least 32 characters for adequate security')
  }
  const rootKey = rootKeyRaw ?? randomBytes(32).toString('hex')

  const storageRaw = args.storage ?? env.STORAGE ?? file.storage ?? 'memory'
  if (storageRaw !== 'memory' && storageRaw !== 'sqlite') {
    throw new Error(`Invalid storage type: ${storageRaw} (must be 'memory' or 'sqlite')`)
  }
  const storage = storageRaw as 'memory' | 'sqlite'

  const dbPathRaw = args.dbPath ?? env.SATGATE_DB_PATH ?? file.dbPath ?? './satgate.db'
  const resolvedDbPath = resolve(dbPathRaw)
  const relFromCwd = relative(process.cwd(), resolvedDbPath)
  if (relFromCwd.startsWith('..')) {
    throw new Error(`dbPath must be within the working directory (got: ${dbPathRaw})`)
  }
  const dbPath = dbPathRaw

  // Pricing: three sources
  // 1. File: pricing.default / pricing.models (per-token via config file)
  // 2. CLI flat: --price / file.price (flat per-request)
  // 3. CLI per-token: --token-price / --model-price (per-token via CLI)
  const pricingDefault = (env.DEFAULT_PRICE ? parseInt(env.DEFAULT_PRICE, 10) : undefined)
    ?? file.pricing?.default
    ?? 1

  const pricing: ModelPricing = {
    default: pricingDefault,
    models: { ...(file.pricing?.models ?? {}) },
  }

  // Flat pricing
  const flatPrice = args.price ?? file.price
  if (flatPrice !== undefined && (!Number.isFinite(flatPrice) || flatPrice < 0)) {
    throw new Error(`Invalid price: ${flatPrice} (must be a non-negative number)`)
  }

  // Per-token CLI pricing
  const tokenPrice = args.tokenPrice
    ?? (env.SATGATE_TOKEN_PRICE ? parseInt(env.SATGATE_TOKEN_PRICE, 10) : undefined)
  if (tokenPrice !== undefined && (!Number.isFinite(tokenPrice) || tokenPrice <= 0)) {
    throw new Error(`Invalid --token-price: ${tokenPrice} (must be a positive integer)`)
  }

  // Model-price entries from CLI and env (CLI last = CLI wins on conflict)
  const cliModelEntries = args.modelPrice ?? []
  const envModelEntries = env.SATGATE_MODEL_PRICE?.split(',').filter(Boolean) ?? []
  const allModelEntries = [...envModelEntries, ...cliModelEntries]

  // Parse model-price entries (split on last colon to allow model IDs with colons)
  const parsedModelPrices: Record<string, number> = {}
  for (const raw of allModelEntries) {
    const lastColonIdx = raw.lastIndexOf(':')
    if (lastColonIdx === -1) {
      throw new Error(`Invalid --model-price value: "${raw}" (expected <model>:<sats>)`)
    }
    const modelPart = raw.slice(0, lastColonIdx)
    const ratePart = raw.slice(lastColonIdx + 1)
    const rate = parseInt(ratePart, 10)
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Invalid --model-price value: "${raw}" (expected <model>:<sats>)`)
    }
    parsedModelPrices[modelPart] = rate
  }

  const hasCliTokenPricing = tokenPrice !== undefined || allModelEntries.length > 0

  // Mutual exclusion: flat pricing vs per-token pricing
  if (flatPrice !== undefined && hasCliTokenPricing) {
    throw new Error('Cannot use --price (flat) and --token-price (per-token) together')
  }

  // Apply CLI per-token pricing overrides
  if (hasCliTokenPricing) {
    if (tokenPrice !== undefined) {
      pricing.default = tokenPrice
    }
    Object.assign(pricing.models, parsedModelPrices)
  }

  const hasPricingConfig = file.pricing !== undefined || hasCliTokenPricing
  const flatPricing = flatPrice !== undefined || !hasPricingConfig
  const price = flatPrice ?? 1

  if (env.FREE_TIER_REQUESTS && !env.FREE_TIER_CREDITS) {
    console.warn('[satgate] WARNING: FREE_TIER_REQUESTS is deprecated, use FREE_TIER_CREDITS instead')
  }
  const freeTierCredits = args.freeTier
    ?? (env.FREE_TIER_CREDITS ? parseInt(env.FREE_TIER_CREDITS, 10) : undefined)
    ?? (env.FREE_TIER_REQUESTS ? parseInt(env.FREE_TIER_REQUESTS, 10) : undefined)
    ?? file.freeTier?.creditsPerDay
    ?? file.freeTier?.requestsPerDay
    ?? 0
  if (!Number.isFinite(freeTierCredits) || freeTierCredits < 0) {
    throw new Error(`Invalid free tier value: ${freeTierCredits} (must be a non-negative integer)`)
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

  const estimatedCostSats = env.SATGATE_ESTIMATED_COST
    ? parseInt(env.SATGATE_ESTIMATED_COST, 10)
    : file.estimatedCostSats ?? Math.max(pricing.default * 2, 5)
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

  // x402 stablecoin config
  const x402Receiver = env.X402_RECEIVER ?? file.x402?.receiverAddress
  const x402Network = env.X402_NETWORK ?? file.x402?.network
  const x402 = x402Receiver && x402Network
    ? {
        receiverAddress: x402Receiver,
        network: x402Network,
        facilitatorUrl: env.X402_FACILITATOR_URL ?? file.x402?.facilitatorUrl,
        facilitatorKey: env.X402_FACILITATOR_KEY ?? file.x402?.facilitatorKey,
        asset: env.X402_ASSET ?? file.x402?.asset,
        creditMode: file.x402?.creditMode,
      }
    : undefined

  const defaultPriceUsd = env.DEFAULT_PRICE_USD
    ? parseInt(env.DEFAULT_PRICE_USD, 10)
    : file.defaultPriceUsd

  // Logging
  const verbose = args.verbose
    ?? (env.SATGATE_VERBOSE !== undefined ? env.SATGATE_VERBOSE === 'true' : undefined)
    ?? file.verbose
    ?? false
  const logFormatRaw = args.logFormat ?? env.SATGATE_LOG_FORMAT ?? file.logFormat ?? 'pretty'
  if (logFormatRaw !== 'pretty' && logFormatRaw !== 'json') {
    throw new Error(`Invalid log format: ${logFormatRaw} (must be 'pretty' or 'json')`)
  }
  const logFormat = logFormatRaw as 'pretty' | 'json'

  const serviceName = env.SATGATE_SERVICE_NAME ?? 'satgate'

  // Announce
  const announce = args.announce ?? (env.ANNOUNCE === 'true' || false)
  const announceRelays = (args.announceRelays ?? env.ANNOUNCE_RELAYS ?? '').split(',').filter(Boolean)
  const announceKey = args.announceKey ?? env.ANNOUNCE_KEY ?? ''

  return {
    upstream: upstream.replace(/\/+$/, ''),
    port,
    rootKey,
    rootKeyGenerated,
    storage,
    dbPath,
    pricing,
    freeTier: { creditsPerDay: freeTierCredits },
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
    x402,
    defaultPriceUsd,
    verbose,
    logFormat,
    serviceName,
    announce,
    announceRelays,
    announceKey,
  }
}
