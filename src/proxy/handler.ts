import { TokenCounter } from './token-counter.js'
import { createStreamingProxy } from './streaming.js'
import { resolveModelPrice, tokenCostToSats } from './pricing.js'
import type { CapacityTracker } from './capacity.js'
import type { ModelPricing } from '../config.js'

export interface ProxyDeps {
  upstream: string
  pricing: ModelPricing
  capacity: CapacityTracker
  reconcile: (paymentHash: string, actualCost: number) => { adjusted: boolean; newBalance: number; delta: number }
  maxBodySize: number
  /** When true, skip token-based reconciliation — a flat per-request fee was charged upfront. */
  flatPricing?: boolean
}

/**
 * Extracts the model name from an OpenAI-compatible request body.
 */
function extractModel(body: Record<string, unknown>): string {
  return typeof body.model === 'string' ? body.model : ''
}

/**
 * Creates the AI proxy handler.
 *
 * @returns A function that proxies a single inference request to the upstream.
 */
export function createProxyHandler(deps: ProxyDeps) {
  return async function handleProxy(
    req: Request,
    paymentHash: string | undefined,
  ): Promise<Response> {
    // Capacity check (before any payment deduction)
    if (!deps.capacity.tryAcquire()) {
      return new Response(
        JSON.stringify({ error: 'Service at capacity, try again later' }),
        { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '5' } },
      )
    }

    let streamingResponse = false
    try {
      // Validate Content-Type
      const contentType = req.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        return new Response(
          JSON.stringify({ error: 'Content-Type must be application/json' }),
          { status: 415, headers: { 'Content-Type': 'application/json' } },
        )
      }

      // Enforce body size limit
      const contentLength = req.headers.get('content-length')
      if (contentLength !== null) {
        const len = parseInt(contentLength, 10)
        if (!Number.isFinite(len) || len > deps.maxBodySize) {
          return new Response(
            JSON.stringify({ error: 'Request body too large' }),
            { status: 413, headers: { 'Content-Type': 'application/json' } },
          )
        }
      }

      // Parse the request body to extract model name
      const bodyText = await req.text()
      if (new TextEncoder().encode(bodyText).byteLength > deps.maxBodySize) {
        return new Response(
          JSON.stringify({ error: 'Request body too large' }),
          { status: 413, headers: { 'Content-Type': 'application/json' } },
        )
      }

      let body: Record<string, unknown>
      try {
        body = JSON.parse(bodyText)
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid JSON body' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }

      const model = extractModel(body)
      const pricePerThousand = resolveModelPrice(deps.pricing, model)
      const isStreaming = body.stream === true

      // Inject stream_options for usage reporting if streaming
      if (isStreaming && !body.stream_options) {
        body.stream_options = { include_usage: true }
      }

      // Build upstream URL
      const url = new URL(req.url)
      const upstreamUrl = `${deps.upstream}${url.pathname}`

      // Fetch from upstream
      let upstreamRes: Response
      try {
        upstreamRes = await fetch(upstreamUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } catch (err) {
        // Upstream unreachable - refund estimated cost
        if (paymentHash) {
          deps.reconcile(paymentHash, 0)
        }
        console.error('[token-toll] upstream error:', err instanceof Error ? err.message : err)
        return new Response(
          JSON.stringify({ error: 'Upstream inference API unreachable' }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        )
      }

      // If upstream returned an error, refund and forward the error
      if (!upstreamRes.ok) {
        if (paymentHash) {
          deps.reconcile(paymentHash, 0)
        }
        return new Response(upstreamRes.body, {
          status: upstreamRes.status,
          headers: { 'Content-Type': upstreamRes.headers.get('content-type') ?? 'application/json' },
        })
      }

      // Handle streaming response
      if (isStreaming && upstreamRes.body) {
        const { readable } = createStreamingProxy(upstreamRes.body, (tokenCount) => {
          // Release capacity slot when stream ends (not in finally)
          deps.capacity.release()
          if (!deps.flatPricing && paymentHash) {
            const satCost = tokenCostToSats(tokenCount, pricePerThousand)
            deps.reconcile(paymentHash, satCost)
          }
        })

        // Mark as streaming so finally doesn't double-release
        streamingResponse = true

        return new Response(readable, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        })
      }

      // Handle non-streaming response
      const responseBody = await upstreamRes.json()
      const counter = new TokenCounter()
      if (responseBody.usage) {
        counter.setBufferedUsage(responseBody.usage)
      }
      const tokenCount = counter.finalCount()
      const satCost = tokenCostToSats(tokenCount, pricePerThousand)

      if (!deps.flatPricing && paymentHash) {
        deps.reconcile(paymentHash, satCost)
      }

      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } finally {
      // Streaming responses release capacity in the onComplete callback
      if (!streamingResponse) {
        deps.capacity.release()
      }
    }
  }
}
