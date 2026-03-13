import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Hono } from 'hono'
import type { Context } from 'hono'
import {
  createTollBooth,
  createX402Rail,
  memoryStorage,
  sqliteStorage,
} from '@thecryptodonkey/toll-booth'
import type { PaymentRail } from '@thecryptodonkey/toll-booth'
import { createHonoTollBooth } from '@thecryptodonkey/toll-booth/hono'
import type { TollBoothEnv } from '@thecryptodonkey/toll-booth/hono'
import type { TokenTollConfig } from './config.js'
import { createNoopLogger, type Logger } from './logger.js'
import { createAuthMiddleware } from './auth/middleware.js'
import { createProxyHandler } from './proxy/handler.js'
import { CapacityTracker } from './proxy/capacity.js'
import { generateWellKnown } from './discovery/well-known.js'
import { generateLlmsTxt } from './discovery/llms-txt.js'
import { generateOpenApiSpec } from './discovery/openapi.js'
import { createHttpFacilitator } from './x402/facilitator.js'

export interface TokenTollServer {
  app: Hono<TollBoothEnv>
  close: () => void
}

export function createTokenTollServer(config: TokenTollConfig): TokenTollServer {
  const logger = config.logger ?? createNoopLogger()
  const app = new Hono<TollBoothEnv>()
  const capacity = new CapacityTracker(config.capacity.maxConcurrent)

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

  // Dual-currency pricing entry
  const pricingEntry = config.defaultPriceUsd !== undefined
    ? { sats: config.estimatedCostSats, usd: config.defaultPriceUsd }
    : config.estimatedCostSats

  // Create toll-booth engine
  const engine = createTollBooth({
    rootKey: config.rootKey,
    storage,
    upstream: config.upstream,
    backend: config.backend,
    pricing: {
      '/v1/chat/completions': pricingEntry,
      '/v1/completions': pricingEntry,
      '/v1/embeddings': pricingEntry,
    },
    defaultInvoiceAmount: config.tiers[0]?.amountSats ?? 1000,
    freeTier: config.freeTier.requestsPerDay > 0 ? { requestsPerDay: config.freeTier.requestsPerDay } : undefined,
    ...(rails.length > 0 && { rails }),
    onPayment: (e) => logger.payment(e),
    onRequest: (e) => logger.request(e),
    onChallenge: (e) => logger.challenge(e),
  })

  // Create Hono toll-booth adapter
  const tollBooth = createHonoTollBooth({ engine })

  // Mount payment routes
  const paymentApp = tollBooth.createPaymentApp({
    storage,
    rootKey: config.rootKey,
    tiers: config.tiers,
    defaultAmount: config.tiers[0]?.amountSats ?? 1000,
    backend: config.backend,
  })
  app.route('/', paymentApp)

  // Discoverability endpoints (no auth required)
  const models: string[] = config.models ?? []

  const paymentMethods = ['lightning', 'cashu']
  if (config.x402) paymentMethods.push('x402')

  app.get('/.well-known/l402', (c) => {
    return c.json(generateWellKnown({
      pricing: config.pricing,
      models,
      tiers: config.tiers,
      paymentMethods,
      x402: config.x402,
    }))
  })

  app.get('/llms.txt', (c) => {
    return c.text(generateLlmsTxt({
      pricing: config.pricing,
      models,
      ...(config.x402 && { x402: { network: config.x402.network } }),
    }))
  })

  app.get('/openapi.json', (c) => {
    return c.json(generateOpenApiSpec({
      models,
      pricing: config.pricing,
      x402: !!config.x402,
    }))
  })

  // Health check
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      models,
      activeRequests: capacity.active,
      maxConcurrent: capacity.maxConcurrent,
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
      const res = await fetch(`${config.upstream}/v1/models`, {
        signal: AbortSignal.timeout(10_000),
      })
      const body = await res.json() as Record<string, unknown>
      modelsCache = { data: body, expires: Date.now() + 60_000 }
      return c.json(body)
    } catch {
      return c.json({ data: [] })
    }
  })

  // AI proxy routes (behind auth middleware)
  const proxyHandler = createProxyHandler({
    upstream: config.upstream,
    pricing: config.pricing,
    capacity,
    reconcile: (paymentHash, actualCost) => engine.reconcile(paymentHash, actualCost),
    maxBodySize: config.maxBodySize,
    flatPricing: config.flatPricing,
    logger,
  })

  if (config.authMode === 'lightning') {
    app.use('/v1/*', tollBooth.authMiddleware)
  } else {
    const authMiddleware = createAuthMiddleware({
      authMode: config.authMode,
      allowlist: config.allowlist,
    })
    app.use('/v1/*', authMiddleware)
  }

  app.post('/v1/chat/completions', async (c: Context<TollBoothEnv>) => {
    const paymentHash = config.authMode === 'lightning' ? c.get('tollBoothPaymentHash') : undefined
    return proxyHandler(c.req.raw, paymentHash)
  })

  app.post('/v1/completions', async (c: Context<TollBoothEnv>) => {
    const paymentHash = config.authMode === 'lightning' ? c.get('tollBoothPaymentHash') : undefined
    return proxyHandler(c.req.raw, paymentHash)
  })

  app.post('/v1/embeddings', async (c: Context<TollBoothEnv>) => {
    const paymentHash = config.authMode === 'lightning' ? c.get('tollBoothPaymentHash') : undefined
    return proxyHandler(c.req.raw, paymentHash)
  })

  return {
    app,
    close: () => {
      // Cleanup if needed
    },
  }
}
