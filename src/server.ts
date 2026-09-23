import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { createHash } from 'node:crypto'
import {
  createTollBooth,
  createL402Rail,
  createIETFPaymentRail,
  createIETFSessionRail,
  createX402Rail,
  createXCashuRail,
  createLnurlcashRail,
  meltToLightning,
  memoryStorage,
  sqliteStorage,
} from '@forgesworn/toll-booth'
import type { PaymentRail } from '@forgesworn/toll-booth'
import { meltNoteToLightning } from './lnurlcash-melt.js'
import { createHonoTollBooth } from '@forgesworn/toll-booth/hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import type { TollBoothEnv } from '@forgesworn/toll-booth/hono'
import type { TokenTollConfig } from './config.js'
import { createNoopLogger } from './logger.js'
import { createAuthMiddleware } from './auth/middleware.js'
import { createProxyHandler } from './proxy/handler.js'
import { CapacityTracker } from './proxy/capacity.js'
import { creditHold, fixedHold, unmeteredHold, usdHold, type Hold } from './proxy/hold.js'
import { generateWellKnown } from './discovery/well-known.js'
import { generateLlmsTxt } from './discovery/llms-txt.js'
import { generateOpenApiSpec } from './discovery/openapi.js'
import { createHttpFacilitator } from './x402/facilitator.js'

/**
 * The address of the TCP peer. Used for per-client limits when forwarded
 * headers are not trusted; toll-booth's own fallback is a shared 0.0.0.0.
 */
export function socketClientIp(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? '0.0.0.0'
  } catch {
    return '0.0.0.0' // no socket (e.g. app.request in tests)
  }
}

/** The inference endpoints: the only routes that cost money. */
const PAID_PATHS = ['/v1/chat/completions', '/v1/completions', '/v1/embeddings'] as const

export interface TokenTollServer {
  app: Hono<TollBoothEnv>
  close: () => void
}

/**
 * Sanitise upstream /v1/models response — only forward id + object fields.
 * Prevents leaking internal upstream metadata (e.g. paths, owners, permissions).
 */
function sanitiseModelsResponse(body: Record<string, unknown>): Record<string, unknown> {
  if (!body || typeof body !== 'object') return { data: [] }
  const raw = body.data
  if (!Array.isArray(raw)) return { data: [] }
  const data = raw
    .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null && typeof m.id === 'string')
    .map(m => ({ id: m.id, object: 'model' }))
  return { object: 'list', data }
}

export function createTokenTollServer(config: TokenTollConfig): TokenTollServer {
  const logger = config.logger ?? createNoopLogger()
  const app = new Hono<TollBoothEnv>()
  const capacity = new CapacityTracker(config.capacity.maxConcurrent)

  // Security headers on every response
  app.use('*', async (c, next) => {
    await next()
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Download-Options', 'noopen')
    c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains')
    c.header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'")
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  })

  // Create storage
  const storage = config.storage === 'sqlite'
    ? sqliteStorage({ path: config.dbPath })
    : memoryStorage()

  // Build payment rails
  const rails: PaymentRail[] = []

  if (config.x402) {
    const facilitator = config.x402.facilitatorUrl
      ? createHttpFacilitator({
          facilitatorUrl: config.x402.facilitatorUrl,
          facilitatorKey: config.x402.facilitatorKey,
        })
      : undefined

    if (facilitator) {
      rails.push(createX402Rail({
        receiverAddress: config.x402.receiverAddress,
        network: config.x402.network,
        asset: config.x402.asset,
        facilitator,
        creditMode: config.x402.creditMode ?? true,
        facilitatorUrl: config.x402.facilitatorUrl,
        storage,
      }))
    }
  }

  if (config.cashu) {
    rails.push(createXCashuRail({
      ...config.cashu,
      onProofsReceived: config.backend
        ? async (proofs, mintUrl, amount) => {
            try {
              const result = await meltToLightning({
                mintUrl,
                proofs,
                createInvoice: async (amountSats) => {
                  const inv = await config.backend!.createInvoice(amountSats, 'satgate cashu melt')
                  return inv.bolt11
                },
              })
              if (result.paid) {
                logger.info(`Cashu melt: ${result.amountSats} sats from ${mintUrl}`)
              } else {
                logger.warn(`Cashu melt failed (${amount} sats from ${mintUrl}): ${result.error}`)
              }
            } catch (err) {
              logger.warn(`Cashu melt error (${amount} sats from ${mintUrl}): ${err instanceof Error ? err.message : err}`)
            }
          }
        : undefined,
    }, storage))
  }

  if (config.lnurlcash) {
    rails.push(createLnurlcashRail({
      mints: config.lnurlcash.mints,
      onNoteReceived: config.backend
        ? async (note) => {
            const result = await meltNoteToLightning({
              note,
              createInvoice: async (amountSats) => {
                const inv = await config.backend!.createInvoice(amountSats, 'satgate lnurlcash melt')
                return inv.bolt11
              },
            })
            if (result.paid) {
              logger.info(`lnurlcash melt: ${result.amountSats} sats from ${note.host}`)
            } else {
              logger.warn(`lnurlcash melt failed (${result.amountSats} sats from ${note.host}): ${result.error}`)
            }
          }
        : undefined,
    }, storage))
  }

  // Dual-scheme: L402 + IETF Payment auth (draft-ryan-httpauth-payment-01)
  // When both are present, every 402 response contains both challenge schemes
  if (config.backend && config.rootKey) {
    const defaultAmount = config.tiers[0]?.amountSats ?? 1000
    rails.push(createL402Rail({
      rootKey: config.rootKey,
      storage,
      defaultAmount,
      backend: config.backend,
      serviceName: config.serviceName,
    }))

    const hmacSecret = createHash('sha256')
      .update(`toll-booth-ietf-hmac-v1${config.rootKey}`)
      .digest('hex')

    // IETF Payment session intent (deposit/bearer/top-up/close for streaming).
    // It must come before the charge rail: rails are tried in order and the
    // charge rail claims every "Authorization: Payment" header, so a session
    // credential behind it would only ever be checked as a charge and fail.
    if (config.sessionIntent) {
      const sessionRail = createIETFSessionRail({
        hmacSecret,
        realm: config.realm ?? 'satgate',
        backend: config.backend,
        storage,
        session: {
          maxDepositSats: config.maxSessionDepositSats,
          maxSessionDurationMs: config.maxSessionDurationMs,
        },
        serviceName: config.serviceName,
        onSessionEvent: (e) => logger.info(`session:${e.type} id=${e.sessionId} amount=${e.amountSats ?? 0} balance=${e.balanceSats ?? 0}`),
      })
      rails.push(sessionRail)
      // Start auto-close sweep for expired sessions
      sessionRail.startSweep()
    }

    rails.push(createIETFPaymentRail({
      hmacSecret,
      realm: config.realm ?? 'satgate',
      backend: config.backend,
      storage,
      serviceName: config.serviceName,
    }))
  }

  // Route price in sats. Flat mode charges the configured per-request price;
  // per-token mode holds the estimated cost up front and reconciles it after.
  const routePriceSats = config.flatPricing ? config.price : config.estimatedCostSats

  // Dual-currency pricing entry
  const pricingEntry = config.defaultPriceUsd !== undefined
    ? { sats: routePriceSats, usd: config.defaultPriceUsd }
    : routePriceSats

  // Create toll-booth engine
  const engine = createTollBooth({
    rootKey: config.rootKey,
    storage,
    upstream: config.upstream,
    backend: config.backend,
    // A flat price of 0 means free inference: leave the routes unpriced so
    // toll-booth passes them through instead of issuing 0-sat invoices.
    pricing: config.flatPricing && config.price === 0
      ? {}
      : Object.fromEntries(PAID_PATHS.map(path => [path, pricingEntry])),
    defaultInvoiceAmount: config.tiers[0]?.amountSats ?? 1000,
    ...(config.maxPendingInvoicesPerIp > 0 && {
      invoiceRateLimit: { maxPendingPerIp: config.maxPendingInvoicesPerIp },
    }),
    freeTier: config.freeTier.creditsPerDay > 0 ? { creditsPerDay: config.freeTier.creditsPerDay } : undefined,
    ...(rails.length > 0 && { rails }),
    serviceName: config.serviceName,
    onPayment: (e) => logger.payment(e),
    onRequest: (e) => logger.request(e),
    onChallenge: (e) => logger.challenge(e),
  })

  // Create Hono toll-booth adapter
  // Behind a trusted proxy, toll-booth reads X-Forwarded-For. Otherwise the
  // socket address identifies the client, rather than toll-booth's shared
  // 0.0.0.0, so free-tier and invoice limits are per client.
  const tollBooth = createHonoTollBooth({
    engine,
    trustProxy: config.trustProxy,
    ...(config.trustedProxies?.length && { trustedProxies: config.trustedProxies }),
    ...(!config.trustProxy && { getClientIp: socketClientIp }),
  })

  // Mount payment routes
  const paymentApp = tollBooth.createPaymentApp({
    storage,
    rootKey: config.rootKey,
    tiers: config.tiers,
    defaultAmount: config.tiers[0]?.amountSats ?? 1000,
    backend: config.backend,
    serviceName: config.serviceName,
    ...(config.maxPendingInvoicesPerIp > 0 && { maxPendingPerIp: config.maxPendingInvoicesPerIp }),
  })
  app.route('/', paymentApp)

  // createTollBooth has no housekeeping of its own: drop invoices nobody paid
  // within a day, and expired Cashu claims, so storage and each client's
  // pending-invoice count do not grow without end.
  const INVOICE_MAX_AGE_MS = 86_400_000
  const pruneTimer = setInterval(() => {
    try {
      storage.pruneExpiredInvoices(INVOICE_MAX_AGE_MS)
      storage.pruneStaleRecords(INVOICE_MAX_AGE_MS)
    } catch (err) {
      logger.warn(`Storage prune failed: ${err instanceof Error ? err.message : err}`)
    }
  }, 3_600_000)
  pruneTimer.unref()

  // Discoverability endpoints (no auth required)
  const models: string[] = config.models ?? []

  const paymentMethods: string[] = []
  if (config.lightning) paymentMethods.push('lightning')
  if (config.cashu) paymentMethods.push('cashu')
  if (config.x402) paymentMethods.push('x402')
  if (config.lnurlcash) paymentMethods.push('lnurlcash')

  app.get('/.well-known/l402', (c) => {
    return c.json(generateWellKnown({
      pricing: config.pricing,
      models,
      tiers: config.tiers,
      paymentMethods,
      freeTier: config.freeTier,
      x402: config.x402,
      cashu: config.cashu ? { mints: config.cashu.mints, unit: config.cashu.unit } : undefined,
      ...(config.lnurlcash && { lnurlcash: { mints: config.lnurlcash.mints } }),
      ...(config.realm && { ietfPayment: { realm: config.realm } }),
      sessionIntent: config.sessionIntent,
    }))
  })

  app.get('/llms.txt', (c) => {
    return c.text(generateLlmsTxt({
      pricing: config.pricing,
      models,
      ...(config.flatPricing && { flatPriceSats: config.price }),
      ...(config.lightning && { lightning: config.lightning, ietfPayment: true }),
      ...(config.x402 && { x402: { network: config.x402.network } }),
      ...(config.cashu && { cashu: true }),
      ...(config.lnurlcash && { lnurlcash: true }),
    }))
  })

  app.get('/openapi.json', (c) => {
    return c.json(generateOpenApiSpec({
      models,
      pricing: config.pricing,
      lightning: !!config.lightning,
      x402: !!config.x402,
      cashu: !!config.cashu,
      lnurlcash: !!config.lnurlcash,
    }))
  })

  // Health check
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      models,
    })
  })

  // Landing page — try two locations:
  // 1. Dev (tsx): __dirname is src/, so ../src/page/index.html → src/page/index.html
  // 2. Docker (compiled): __dirname is dist/src/, so ../page/index.html → dist/page/index.html
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const landingPagePaths = [
    join(__dirname, '..', 'src', 'page', 'index.html'),
    join(__dirname, '..', 'page', 'index.html'),
  ]
  let landingPageHtml: string | undefined
  for (const p of landingPagePaths) {
    try {
      landingPageHtml = readFileSync(p, 'utf-8')
      break
    } catch {
      // Try next path
    }
  }

  if (landingPageHtml) {
    const html = landingPageHtml
    app.get('/', (c) => c.html(html))
  }

  // /v1/models passes through without auth — cached for 60s to prevent upstream amplification
  let modelsCache: { data: Record<string, unknown>; expires: number } | undefined
  app.get('/v1/models', async (c) => {
    if (modelsCache && Date.now() < modelsCache.expires) {
      return c.json(modelsCache.data)
    }
    try {
      const maxModelsBytes = 1024 * 1024 // 1 MiB limit for /v1/models response
      const res = await fetch(`${config.upstream}/v1/models`, {
        signal: AbortSignal.timeout(10_000),
        ...(config.upstreamKey && { headers: { Authorization: `Bearer ${config.upstreamKey}` } }),
      })
      // Read body incrementally to enforce size limit
      const reader = res.body?.getReader()
      if (!reader) return c.json({ data: [] })
      const chunks: Uint8Array[] = []
      let totalBytes = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        totalBytes += value.byteLength
        if (totalBytes > maxModelsBytes) {
          await reader.cancel('response too large').catch(() => {})
          return c.json({ data: [] })
        }
        chunks.push(value)
      }
      const bodyText = new TextDecoder().decode(Buffer.concat(chunks))
      const body = JSON.parse(bodyText) as Record<string, unknown>
      // Sanitise upstream response — only forward model IDs, not arbitrary fields
      const sanitised = sanitiseModelsResponse(body)
      // Only cache non-empty model lists — transient upstream errors should not
      // poison the cache with empty data for 60 seconds
      const dataArr = sanitised.data as unknown[]
      if (Array.isArray(dataArr) && dataArr.length > 0) {
        modelsCache = { data: sanitised, expires: Date.now() + 60_000 }
      }
      return c.json(sanitised)
    } catch {
      return c.json({ data: [] })
    }
  })

  // AI proxy routes (behind auth middleware)
  const proxyHandler = createProxyHandler({
    upstream: config.upstream,
    upstreamKey: config.upstreamKey,
    pricing: config.pricing,
    capacity,
    maxBodySize: config.maxBodySize,
    flatPricing: config.flatPricing,
    maxTokens: config.maxTokens,
    models: [...new Set([...(config.models ?? []), ...Object.keys(config.pricing.models)])],
    logger,
  })

  const paidAuth = config.authMode === 'lightning' || config.authMode === 'cashu'

  /**
   * The hold for one request: what toll-booth has already taken for it and
   * how that charge may move. Settled per request by the proxy, so
   * concurrent requests on one credential cannot clobber each other.
   */
  function holdFor(c: Context<TollBoothEnv>): Hold {
    if (!paidAuth) return unmeteredHold()
    const paymentHash = c.get('tollBoothPaymentHash')
    if (!paymentHash) {
      // Free tier: the route price came out of today's allowance
      return c.get('tollBoothFreeRemaining') !== undefined ? fixedHold(routePriceSats) : unmeteredHold()
    }
    const held = c.get('tollBoothEstimatedCost') ?? 0
    const creditBalance = c.get('tollBoothCreditBalance')
    const isUsd = c.req.header('payment-signature') !== undefined
      || c.req.header('x-payment') !== undefined
      || (config.cashu?.unit === 'usd' && c.req.header('x-cashu') !== undefined)
    if (isUsd) return usdHold(storage, paymentHash, held, creditBalance !== undefined)
    // A per-request payment (IETF Payment charge) reports no balance
    if (creditBalance === undefined) return fixedHold(held)
    // IETF Payment session: the payment id is the session id
    if (storage.getSession(paymentHash)) return fixedHold(held)
    return creditHold(storage, paymentHash, held)
  }

  const proxy = (c: Context<TollBoothEnv>) => proxyHandler(c.req.raw, undefined, holdFor(c))

  // Only the inference endpoints cost money, so only POSTs to them go
  // through payment or allowlist auth. GET /v1/models stays free, and other
  // methods and paths fall through to a 404 instead of minting invoices.
  const authMiddleware = paidAuth
    ? tollBooth.authMiddleware
    : createAuthMiddleware({
        authMode: config.authMode,
        allowlist: config.allowlist,
        publicUrl: config.publicUrl,
        trustProxy: config.trustProxy,
      })

  // Forward toll-booth credit/free-tier context as response headers.
  // Must run AFTER next() so c.header() applies to the actual response.
  const forwardPaymentHeaders = async (c: Context<TollBoothEnv>, next: () => Promise<void>) => {
    await next()
    const creditBalance = c.get('tollBoothCreditBalance')
    if (creditBalance !== undefined) {
      c.header('X-Credit-Balance', String(creditBalance))
    }
    const estimatedCost = c.get('tollBoothEstimatedCost')
    if (estimatedCost !== undefined) {
      c.header('X-Estimated-Cost', String(estimatedCost))
    }
    const freeRemaining = c.get('tollBoothFreeRemaining')
    if (freeRemaining !== undefined) {
      c.header('X-Free-Remaining', String(freeRemaining))
    }
  }

  // HEAD is a free price probe. It is answered here rather than by
  // toll-booth, which would verify (and debit) any credential sent with it.
  // Hono dispatches HEAD to GET routes; a plain GET is still a 404.
  const priceProbe = (c: Context<TollBoothEnv>) => {
    if (c.req.method !== 'HEAD') return c.notFound()
    if (!paidAuth || (config.flatPricing && config.price === 0)) return c.body(null, 200)
    c.header('X-L402-Price-Sats', String(routePriceSats))
    if (config.defaultPriceUsd !== undefined) c.header('X-L402-Price-Usd', String(config.defaultPriceUsd))
    c.header('WWW-Authenticate', 'L402 price-only')
    c.header('Cache-Control', 'no-store')
    return c.body(null, 402)
  }

  for (const path of PAID_PATHS) {
    app.get(path, priceProbe)
    app.post(path, authMiddleware, forwardPaymentHeaders)
  }

  app.post('/v1/chat/completions', proxy)
  app.post('/v1/completions', proxy)
  app.post('/v1/embeddings', proxy)

  return {
    app,
    close: () => {
      clearInterval(pruneTimer)
    },
  }
}
