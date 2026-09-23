import { TokenCounter } from './token-counter.js'
import { createStreamingProxy } from './streaming.js'
import { isServedModel, resolveModelPrice, tokenCostToSats } from './pricing.js'
import type { CapacityTracker } from './capacity.js'
import { reconcileHold, unmeteredHold, type Hold } from './hold.js'
import type { ModelPricing } from '../config.js'
import type { Logger } from '../logger.js'

/** Allowed upstream path prefixes — anything else is rejected. */
const ALLOWED_PATH_PREFIXES = ['/v1/chat/completions', '/v1/completions', '/v1/embeddings']

export interface ProxyDeps {
  upstream: string
  pricing: ModelPricing
  capacity: CapacityTracker
  /**
   * Settles a payment hash at its actual cost. Only used when the caller
   * passes no hold; the server always passes one.
   */
  reconcile?: (paymentHash: string, actualCost: number) => { adjusted: boolean; newBalance: number; delta: number }
  maxBodySize: number
  /** When true, skip token-based reconciliation — a flat per-request fee was charged upfront. */
  flatPricing?: boolean
  /** Timeout in ms for upstream requests (default: 120_000). */
  upstreamTimeout?: number
  /**
   * Model names this gateway serves (auto-detected upstream models plus
   * configured prices). Requests for any other name are refused before
   * reaching the upstream. Empty or omitted: no check.
   */
  models?: readonly string[]
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
    suppliedHold?: Hold,
  ): Promise<Response> {
    const hold = suppliedHold
      ?? (paymentHash && deps.reconcile ? reconcileHold(deps.reconcile, paymentHash) : unmeteredHold())
    // Refund helper for every path that serves no inference
    const refund = () => hold.settle(0)

    // Validate request before acquiring capacity — cheap checks first to avoid
    // tying up capacity slots during body reads or for invalid requests
    const requestPath = new URL(req.url).pathname
    if (!ALLOWED_PATH_PREFIXES.some(p => requestPath === p)) {
      refund()
      return new Response(
        JSON.stringify({ error: 'Not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const contentType = req.headers.get('content-type')
    const mediaType = contentType?.split(';')[0]?.trim().toLowerCase()
    if (mediaType !== 'application/json') {
      refund()
      return new Response(
        JSON.stringify({ error: 'Content-Type must be application/json' }),
        { status: 415, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const contentLength = req.headers.get('content-length')
    if (contentLength !== null) {
      const len = parseInt(contentLength, 10)
      if (!Number.isFinite(len) || len > deps.maxBodySize) {
        refund()
        return new Response(
          JSON.stringify({ error: 'Request body too large' }),
          { status: 413, headers: { 'Content-Type': 'application/json' } },
        )
      }
    }

    // Read and parse body BEFORE acquiring capacity to prevent slow uploads from holding slots.
    // Enforce a 30-second hard deadline using AbortSignal.timeout so stalled reads are interrupted.
    let bodyText: string
    if (req.body) {
      const bodyAbort = AbortSignal.timeout(30_000)
      const reader = req.body.getReader()
      const decoder = new TextDecoder()
      const chunks: string[] = []
      let totalBytes = 0
      try {
        while (true) {
          if (bodyAbort.aborted) {
            await reader.cancel('body read deadline exceeded').catch(() => {})
            refund()
            return new Response(
              JSON.stringify({ error: 'Request body read timed out' }),
              { status: 408, headers: { 'Content-Type': 'application/json' } },
            )
          }
          // Race the read against the abort signal so stalled clients don't block forever
          const result = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => {
              if (bodyAbort.aborted) reject(new DOMException('body read deadline exceeded', 'TimeoutError'))
              bodyAbort.addEventListener('abort', () => reject(new DOMException('body read deadline exceeded', 'TimeoutError')), { once: true })
            }),
          ])
          if (result.done) break
          totalBytes += result.value.byteLength
          if (totalBytes > deps.maxBodySize) {
            await reader.cancel('body too large').catch(() => {})
            refund()
            return new Response(
              JSON.stringify({ error: 'Request body too large' }),
              { status: 413, headers: { 'Content-Type': 'application/json' } },
            )
          }
          chunks.push(decoder.decode(result.value, { stream: true }))
        }
        chunks.push(decoder.decode()) // flush remaining
      } catch (err) {
        await reader.cancel('body read failed').catch(() => {})
        // Refund any pre-reserved Lightning payment on body read failure
        refund()
        if (err instanceof DOMException && err.name === 'TimeoutError') {
          return new Response(
            JSON.stringify({ error: 'Request body read timed out' }),
            { status: 408, headers: { 'Content-Type': 'application/json' } },
          )
        }
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
        refund()
        return new Response(
          JSON.stringify({ error: 'Request body must be a JSON object' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }
      body = parsed
    } catch {
      refund()
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Refuse models this gateway does not serve. Pricing looks models up by
    // name, so a name the upstream resolves to a priced model but pricing
    // does not recognise would otherwise be billed at the default price.
    const requestedModel = extractModel(body)
    if (!isServedModel(requestedModel, deps.models ?? [])) {
      refund()
      return new Response(
        JSON.stringify({ error: `Unknown model: ${requestedModel.slice(0, 200) || '(none)'}`, models: deps.models }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Now acquire capacity — body is validated and parsed, no slow client can hold a slot
    if (!deps.capacity.tryAcquire()) {
      refund()
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

      // Always ask for usage on streams: billing depends on it, so a client
      // must not be able to switch it off with its own stream_options.
      if (isStreaming) {
        const clientOptions = typeof body.stream_options === 'object' && body.stream_options !== null && !Array.isArray(body.stream_options)
          ? body.stream_options as Record<string, unknown>
          : {}
        body.stream_options = { ...clientOptions, include_usage: true }
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
        refund()
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
        refund()
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
        let proxy: { readable: ReadableStream<Uint8Array> }
        try {
          proxy = createStreamingProxy(upstreamRes.body, (tokenCount) => {
            // Release capacity slot when stream ends (not in finally)
            deps.capacity.release()
            if (!deps.flatPricing && hold.metered) {
              hold.settle(tokenCostToSats(tokenCount, pricePerThousand))
            }
          }, undefined, deps.maxBodySize)
        } catch {
          // createStreamingProxy failed — capacity will be released by finally
          refund()
          return new Response(
            JSON.stringify({ error: 'Internal streaming error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // Mark as streaming so finally doesn't double-release
        streamingResponse = true

        return new Response(proxy.readable, {
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
          refund()
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
              refund()
              return new Response(
                JSON.stringify({ error: 'Upstream response too large' }),
                { status: 502, headers: { 'Content-Type': 'application/json' } },
              )
            }
            if (Date.now() > deadline) {
              await reader.cancel('deadline exceeded').catch(() => {})
              refund()
              return new Response(
                JSON.stringify({ error: 'Upstream response timed out' }),
                { status: 504, headers: { 'Content-Type': 'application/json' } },
              )
            }
            chunks.push(decoder.decode(value, { stream: true }))
          }
          chunks.push(decoder.decode()) // flush remaining
        } catch {
          refund()
          return new Response(
            JSON.stringify({ error: 'Upstream response read failed' }),
            { status: 502, headers: { 'Content-Type': 'application/json' } },
          )
        }
        responseText = chunks.join('')
      } else {
        responseText = ''
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let responseBody: any
      try {
        responseBody = JSON.parse(responseText)
      } catch {
        refund()
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

      if (!deps.flatPricing && hold.metered) {
        hold.settle(satCost)
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
