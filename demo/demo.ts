/**
 * Demo server for VHS terminal recording.
 *
 * Boots a satgate server with a mock Lightning backend pointed at
 * real Ollama on localhost:11434. No real Lightning infrastructure required.
 *
 * The app is built manually (not via createTokenTollServer) so the mock
 * Lightning backend can access the toll-booth storage instance directly
 * to call settleWithCredit().
 *
 * Usage:  npx tsx demo/demo.ts
 */

import { randomBytes, createHash } from 'node:crypto'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { serve } from '@hono/node-server'
import { createTollBooth, memoryStorage } from '@forgesworn/toll-booth'
import { createHonoTollBooth } from '@forgesworn/toll-booth/hono'
import type { TollBoothEnv } from '@forgesworn/toll-booth/hono'
import type { LightningBackend, Invoice, InvoiceStatus } from '@forgesworn/toll-booth'
import { createProxyHandler } from '../src/proxy/handler.js'
import { CapacityTracker } from '../src/proxy/capacity.js'
import { createLogger } from '../src/logger.js'
import { generateWellKnown } from '../src/discovery/well-known.js'
import { generateLlmsTxt } from '../src/discovery/llms-txt.js'
import { generateOpenApiSpec } from '../src/discovery/openapi.js'

// -- Configuration ------------------------------------------------------------

const UPSTREAM = 'http://localhost:11434'
const PORT = 3000

const rootKey = randomBytes(32).toString('hex')

/** Model-based pricing for satgate proxy and discovery endpoints. */
const tokenTollPricing = { default: 1, models: {} }

/** Route-based pricing for toll-booth engine. */
const tollBoothPricing: Record<string, number> = {
  '/v1/chat/completions': 100,
  '/v1/completions': 100,
  '/v1/embeddings': 100,
}

// -- ANSI colours -------------------------------------------------------------

const BOLD  = '\x1b[1m'
const DIM   = '\x1b[2m'
const GREEN = '\x1b[32m'
const RESET = '\x1b[0m'

// -- Mock Lightning backend ---------------------------------------------------

const storage = memoryStorage()

/**
 * Self-contained mock Lightning backend.
 * Generates fake BOLT11 strings and immediately settles invoices
 * via the shared storage instance — no real Lightning needed.
 */
const backend: LightningBackend = {
  async createInvoice(amountSats: number): Promise<Invoice> {
    const preimage = randomBytes(32)
    const paymentHash = createHash('sha256').update(preimage).digest('hex')

    // Settle immediately so the L402 credential is valid straight away
    storage.settleWithCredit(paymentHash, amountSats, preimage.toString('hex'))

    const bolt11 = `lnbc${amountSats}n1demo${randomBytes(20).toString('hex')}`
    return { bolt11, paymentHash }
  },

  async checkInvoice(paymentHash: string): Promise<InvoiceStatus> {
    return {
      paid: storage.isSettled(paymentHash),
      preimage: storage.getSettlementSecret(paymentHash),
    }
  },
}

// -- Auto-detect Ollama models ------------------------------------------------

async function discoverModels(): Promise<string[]> {
  try {
    const res = await fetch(`${UPSTREAM}/v1/models`, {
      signal: AbortSignal.timeout(5_000),
    })
    const body = (await res.json()) as { data?: Array<{ id: string }> }
    return (body.data ?? []).map((m) => m.id)
  } catch {
    return []
  }
}

// -- Main ---------------------------------------------------------------------

async function main() {
  const logger = createLogger({ format: 'pretty', verbose: false })
  const models = await discoverModels()

  // Create toll-booth engine with callbacks wired to logger
  const engine = createTollBooth({
    backend,
    storage,
    rootKey,
    upstream: UPSTREAM,
    pricing: tollBoothPricing,
    defaultInvoiceAmount: 100,
    freeTier: { creditsPerDay: 100 },
    onPayment: (e) => logger.payment(e),
    onRequest: (e) => logger.request(e),
    onChallenge: (e) => logger.challenge(e),
  })

  // Create Hono toll-booth adapter and mount payment routes
  const tollBooth = createHonoTollBooth({ engine })
  const app = new Hono<TollBoothEnv>()

  const paymentApp = tollBooth.createPaymentApp({
    backend,
    storage,
    rootKey,
    tiers: [],
    defaultAmount: 100,
  })
  app.route('/', paymentApp)

  // -- Discovery endpoints (no auth required) ---------------------------------

  app.get('/.well-known/l402', (c) => {
    return c.json(generateWellKnown({
      pricing: tokenTollPricing,
      models,
      tiers: [],
      paymentMethods: ['lightning', 'cashu'],
    }))
  })

  app.get('/llms.txt', (c) => {
    return c.text(generateLlmsTxt({
      pricing: tokenTollPricing,
      models,
    }))
  })

  app.get('/openapi.json', (c) => {
    return c.json(generateOpenApiSpec({
      models,
      pricing: tokenTollPricing,
    }))
  })

  // -- Health check -----------------------------------------------------------

  const capacity = new CapacityTracker(10)

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      models,
    })
  })

  // -- /v1/models (unauthenticated, cached) -----------------------------------

  let modelsCache: { data: Record<string, unknown>; expires: number } | undefined
  app.get('/v1/models', async (c) => {
    if (modelsCache && Date.now() < modelsCache.expires) {
      return c.json(modelsCache.data)
    }
    try {
      const res = await fetch(`${UPSTREAM}/v1/models`, {
        signal: AbortSignal.timeout(10_000),
      })
      const body = (await res.json()) as Record<string, unknown>
      modelsCache = { data: body, expires: Date.now() + 60_000 }
      return c.json(body)
    } catch {
      return c.json({ data: [] })
    }
  })

  // -- AI proxy routes (behind auth middleware) --------------------------------

  const proxyHandler = createProxyHandler({
    upstream: UPSTREAM,
    pricing: tokenTollPricing,
    capacity,
    reconcile: (paymentHash, actualCost) => engine.reconcile(paymentHash, actualCost),
    maxBodySize: 1_048_576,
    flatPricing: false,
    logger,
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

  // -- Start server -----------------------------------------------------------

  serve({ fetch: app.fetch, port: PORT }, () => {
    const modelList = models.length > 0
      ? models.join(', ')
      : 'none detected'

    process.stderr.write('\n')
    process.stderr.write(`${BOLD}  satgate demo${RESET}\n`)
    process.stderr.write(`  ${'─'.repeat(44)}\n`)
    process.stderr.write(`  ${DIM}Upstream${RESET}    ${UPSTREAM}\n`)
    process.stderr.write(`  ${DIM}Gateway${RESET}     http://localhost:${PORT}\n`)
    process.stderr.write(`  ${DIM}Models${RESET}      ${modelList}\n`)
    process.stderr.write('\n')
    process.stderr.write(`  ${DIM}Pricing${RESET}     1 sat / 1k tokens (flat: 100 sats/req)\n`)
    process.stderr.write(`  ${DIM}Free tier${RESET}   100 sats/day\n`)
    process.stderr.write('\n')
    process.stderr.write(`  ${GREEN}listening on :${PORT}${RESET}\n`)
    process.stderr.write('\n')
  })
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err}\n`)
  process.exit(1)
})
