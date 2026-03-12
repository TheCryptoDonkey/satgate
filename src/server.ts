import { Hono } from 'hono'
import type { Context } from 'hono'
import {
  createTollBooth,
  memoryStorage,
} from '@thecryptodonkey/toll-booth'
import { createHonoTollBooth } from '@thecryptodonkey/toll-booth/hono'
import type { TollBoothEnv } from '@thecryptodonkey/toll-booth/hono'
import type { TokenTollConfig } from './config.js'
import { createProxyHandler } from './proxy/handler.js'
import { CapacityTracker } from './proxy/capacity.js'
import { generateWellKnown } from './discovery/well-known.js'
import { generateLlmsTxt } from './discovery/llms-txt.js'
import { generateOpenApiSpec } from './discovery/openapi.js'

export interface TokenTollServer {
  app: Hono<TollBoothEnv>
  close: () => void
}

export function createTokenTollServer(config: TokenTollConfig): TokenTollServer {
  const app = new Hono<TollBoothEnv>()
  const capacity = new CapacityTracker(config.capacity.maxConcurrent)

  // Create storage
  const storage = memoryStorage()

  // Create toll-booth engine
  const engine = createTollBooth({
    rootKey: config.rootKey,
    storage,
    upstream: config.upstream,
    pricing: {
      '/v1/chat/completions': config.estimatedCostSats,
      '/v1/completions': config.estimatedCostSats,
      '/v1/embeddings': config.estimatedCostSats,
    },
    defaultInvoiceAmount: config.tiers[0]?.amountSats ?? 1000,
    freeTier: config.freeTier.requestsPerDay > 0 ? { requestsPerDay: config.freeTier.requestsPerDay } : undefined,
  })

  // Create Hono toll-booth adapter
  const tollBooth = createHonoTollBooth({ engine })

  // Mount payment routes
  const paymentApp = tollBooth.createPaymentApp({
    storage,
    rootKey: config.rootKey,
    tiers: config.tiers,
    defaultAmount: config.tiers[0]?.amountSats ?? 1000,
  })
  app.route('/', paymentApp)

  // Discoverability endpoints (no auth required)
  const models: string[] = []

  app.get('/.well-known/l402', (c) => {
    return c.json(generateWellKnown({
      pricing: config.pricing,
      models,
      tiers: config.tiers,
      paymentMethods: ['lightning', 'cashu'],
    }))
  })

  app.get('/llms.txt', (c) => {
    return c.text(generateLlmsTxt({ pricing: config.pricing, models }))
  })

  app.get('/openapi.json', (c) => {
    return c.json(generateOpenApiSpec({ models, pricing: config.pricing }))
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

  // /v1/models passes through without auth
  app.get('/v1/models', async (c) => {
    try {
      const res = await fetch(`${config.upstream}/v1/models`)
      const body = await res.json()
      return c.json(body as Record<string, unknown>)
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
  })

  app.use('/v1/*', tollBooth.authMiddleware)

  app.post('/v1/chat/completions', async (c: Context<TollBoothEnv>) => {
    const paymentHash = c.get('tollBoothPaymentHash')
    return proxyHandler(c.req.raw, paymentHash)
  })

  app.post('/v1/completions', async (c: Context<TollBoothEnv>) => {
    const paymentHash = c.get('tollBoothPaymentHash')
    return proxyHandler(c.req.raw, paymentHash)
  })

  app.post('/v1/embeddings', async (c: Context<TollBoothEnv>) => {
    const paymentHash = c.get('tollBoothPaymentHash')
    return proxyHandler(c.req.raw, paymentHash)
  })

  return {
    app,
    close: () => {
      // Cleanup if needed
    },
  }
}
