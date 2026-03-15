import { TokenCounter } from './token-counter.js'
import { createStreamingProxy } from './streaming.js'
import { resolveModelPrice, tokenCostToSats } from './pricing.js'
import type { CapacityTracker } from './capacity.js'
import type { ModelPricing } from '../config.js'
import type { Logger } from '../logger.js'

/** Allowed upstream path prefixes — anything else is rejected. */
const ALLOWED_PATH_PREFIXES = ['/v1/chat/completions', '/v1/completions', '/v1/embeddings']

export interface ProxyDeps {
  upstream: string
  pricing: ModelPricing
  capacity: CapacityTracker
  reconcile: (paymentHash: string, actualCost: number) => { adjusted: boolean; newBalance: number; delta: number }
  maxBodySize: number
  /** When true, skip token-based reconciliation — a flat per-request fee was charged upfront. */
  flatPricing?: boolean
  /** Timeout in ms for upstream requests (default: 120_000). */
  upstreamTimeout?: number
  /** Logger instance — if omitted, errors are silent. */
  logger?: Logger
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
    // Validate request before acquiring capacity — cheap checks first to avoid
    // tying up capacity slots during body reads or for invalid requests
    const requestPath = new URL(req.url).pathname
    if (!ALLOWED_PATH_PREFIXES.some(p => requestPath === p)) {
      return new Response(
        JSON.stringify({ error: 'Not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const contentType = req.headers.get('content-type')
    const mediaType = contentType?.split(';')[0]?.trim().toLowerCase()
    if (mediaType !== 'application/json') {
      return new Response(
        JSON.stringify({ error: 'Content-Type must be application/json' }),
        { status: 415, headers: { 'Content-Type': 'application/json' } },
      )
    }

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

    // Read and parse body BEFORE acquiring capacity to prevent slow uploads from holding slots.
    // Enforce a 30-second deadline to prevent slow-trickle clients from tying up connections.
    let bodyText: string
    if (req.body) {
      const reader = req.body.getReader()
      const decoder = new TextDecoder()
      const chunks: string[] = []
      let totalBytes = 0
      const bodyDeadline = Date.now() + 30_000
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          totalBytes += value.byteLength
          if (totalBytes > deps.maxBodySize) {
            await reader.cancel('body too large').catch(() => {})
            return new Response(
              JSON.stringify({ error: 'Request body too large' }),
              { status: 413, headers: { 'Content-Type': 'application/json' } },
            )
          }
          if (Date.now() > bodyDeadline) {
            await reader.cancel('body read deadline exceeded').catch(() => {})
            return new Response(
              JSON.stringify({ error: 'Request body read timed out' }),
              { status: 408, headers: { 'Content-Type': 'application/json' } },
            )
          }
          chunks.push(decoder.decode(value, { stream: true }))
        }
        chunks.push(decoder.decode()) // flush remaining
      } catch {
        return new Response(
          JSON.stringify({ error: 'Request body read failed' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }
      bodyText = chunks.join('')
    } else {
      bodyText = ''
    }
    let body: Record<string, unknown>
    try {
      const parsed = JSON.parse(bodyText)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return new Response(
          JSON.stringify({ error: 'Request body must be a JSON object' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }
      body = parsed
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Now acquire capacity — body is validated and parsed, no slow client can hold a slot
    if (!deps.capacity.tryAcquire()) {
      return new Response(
        JSON.stringify({ error: 'Service at capacity, try again later' }),
        { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '5' } },
      )
    }

    const start = Date.now()
    let streamingResponse = false
    try {
      const model = extractModel(body)
      const pricePerThousand = resolveModelPrice(deps.pricing, model)
      const isStreaming = body.stream === true

      // Inject stream_options for usage reporting if streaming
      if (isStreaming && !body.stream_options) {
        body.stream_options = { include_usage: true }
      }

      // Build upstream URL using the already-validated requestPath
      const upstreamUrl = `${deps.upstream}${requestPath}`

      // Fetch from upstream
      const timeout = deps.upstreamTimeout ?? 120_000
      let upstreamRes: Response
      try {
        upstreamRes = await fetch(upstreamUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeout),
        })
      } catch (err) {
        // Upstream unreachable - refund estimated cost
        if (paymentHash) {
          deps.reconcile(paymentHash, 0)
        }
        deps.logger?.error('upstream error', {
          endpoint: new URL(req.url).pathname,
          method: req.method,
          latencyMs: Date.now() - start,
          reason: err instanceof Error ? err.message : String(err),
        })
        return new Response(
          JSON.stringify({ error: 'Upstream inference API unreachable' }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        )
      }

      // If upstream returned an error, refund and return a generic error
      // (don't forward raw upstream body — may leak internal details)
      if (!upstreamRes.ok) {
        if (paymentHash) {
          deps.reconcile(paymentHash, 0)
        }
        // Consume and discard the upstream error body to prevent connection leaks
        await upstreamRes.body?.cancel().catch(() => {})
        const status = upstreamRes.status >= 400 && upstreamRes.status < 600
          ? upstreamRes.status
          : 502
        return new Response(
          JSON.stringify({ error: `Upstream returned ${upstreamRes.status}` }),
          { status, headers: { 'Content-Type': 'application/json' } },
        )
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
        }, undefined, deps.maxBodySize)

        // Mark as streaming so finally doesn't double-release
        streamingResponse = true

        return new Response(readable, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
        })
      }

      // Handle non-streaming response — enforce size limit during read
      const upstreamContentLength = upstreamRes.headers.get('content-length')
      if (upstreamContentLength !== null) {
        const len = parseInt(upstreamContentLength, 10)
        if (Number.isFinite(len) && len > deps.maxBodySize) {
          if (paymentHash) deps.reconcile(paymentHash, 0)
          await upstreamRes.body?.cancel().catch(() => {})
          return new Response(
            JSON.stringify({ error: 'Upstream response too large' }),
            { status: 502, headers: { 'Content-Type': 'application/json' } },
          )
        }
      }
      // Read body incrementally to enforce size limit even without Content-Length.
      // Also enforce a total elapsed deadline to prevent slow-trickle body attacks.
      let responseText: string
      if (upstreamRes.body) {
        const reader = upstreamRes.body.getReader()
        const decoder = new TextDecoder()
        const chunks: string[] = []
        let totalBytes = 0
        const deadline = start + (timeout * 2)
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            totalBytes += value.byteLength
            if (totalBytes > deps.maxBodySize) {
              await reader.cancel('response too large').catch(() => {})
              if (paymentHash) deps.reconcile(paymentHash, 0)
              return new Response(
                JSON.stringify({ error: 'Upstream response too large' }),
                { status: 502, headers: { 'Content-Type': 'application/json' } },
              )
            }
            if (Date.now() > deadline) {
              await reader.cancel('deadline exceeded').catch(() => {})
              if (paymentHash) deps.reconcile(paymentHash, 0)
              return new Response(
                JSON.stringify({ error: 'Upstream response timed out' }),
                { status: 504, headers: { 'Content-Type': 'application/json' } },
              )
            }
            chunks.push(decoder.decode(value, { stream: true }))
          }
          chunks.push(decoder.decode()) // flush remaining
        } catch {
          if (paymentHash) deps.reconcile(paymentHash, 0)
          return new Response(
            JSON.stringify({ error: 'Upstream response read failed' }),
            { status: 502, headers: { 'Content-Type': 'application/json' } },
          )
        }
        responseText = chunks.join('')
      } else {
        responseText = await upstreamRes.text()
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let responseBody: any
      try {
        responseBody = JSON.parse(responseText)
      } catch {
        return new Response(
          JSON.stringify({ error: 'Upstream returned invalid JSON' }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        )
      }
      const counter = new TokenCounter()
      if (responseBody && typeof responseBody === 'object' && responseBody.usage) {
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
