import { TokenCounter } from './token-counter.js'

/** Default inactivity timeout for streaming responses (2 minutes). */
const DEFAULT_INACTIVITY_TIMEOUT_MS = 120_000

/** Default maximum cumulative bytes for a streaming response (100 MiB). */
const DEFAULT_MAX_STREAM_BYTES = 100 * 1024 * 1024

/** Default absolute duration cap for a single streaming response (30 minutes). */
const DEFAULT_MAX_STREAM_DURATION_MS = 30 * 60 * 1000

/**
 * Creates a ReadableStream that pipes upstream SSE chunks through while counting tokens.
 *
 * @param upstream - The upstream SSE ReadableStream
 * @param onComplete - Called with the final token count after the stream ends or errors
 * @param inactivityTimeoutMs - Max time between chunks before aborting (default: 120s)
 * @param maxStreamBytes - Maximum cumulative bytes before aborting (default: 100 MiB)
 * @param maxStreamDurationMs - Absolute duration cap before aborting (default: 30min)
 * @returns An object with the readable side
 */
export function createStreamingProxy(
  upstream: ReadableStream<Uint8Array>,
  onComplete: (tokenCount: number) => void,
  inactivityTimeoutMs: number = DEFAULT_INACTIVITY_TIMEOUT_MS,
  maxStreamBytes: number = DEFAULT_MAX_STREAM_BYTES,
  maxStreamDurationMs: number = DEFAULT_MAX_STREAM_DURATION_MS,
): { readable: ReadableStream<Uint8Array> } {
  const counter = new TokenCounter()
  const decoder = new TextDecoder()
  let completeCalled = false
  let inactivityTimer: ReturnType<typeof setTimeout> | undefined
  let durationTimer: ReturnType<typeof setTimeout> | undefined
  let totalBytes = 0

  function finish() {
    if (completeCalled) return
    completeCalled = true
    clearTimeout(inactivityTimer)
    clearTimeout(durationTimer)
    onComplete(counter.finalCount())
  }

  // Hoist reader so cancel() can abort the upstream when the client disconnects
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      reader = upstream.getReader()

      function resetTimer() {
        clearTimeout(inactivityTimer)
        inactivityTimer = setTimeout(() => {
          reader!.cancel('inactivity timeout').catch(() => {})
          controller.close()
          finish()
        }, inactivityTimeoutMs)
      }

      resetTimer()

      // Absolute duration cap — prevents slow-trickle attacks that stay just
      // under the inactivity timeout from holding a capacity slot indefinitely
      durationTimer = setTimeout(() => {
        reader!.cancel('stream duration limit exceeded').catch(() => {})
        controller.close()
        finish()
      }, maxStreamDurationMs)

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          resetTimer()
          totalBytes += value.byteLength
          if (totalBytes > maxStreamBytes) {
            reader.cancel('stream size limit exceeded').catch(() => {})
            const errMsg = new TextEncoder().encode('data: {"error":"stream size limit exceeded"}\n\n')
            controller.enqueue(errMsg)
            controller.close()
            finish()
            return
          }
          controller.enqueue(value)
          const text = decoder.decode(value, { stream: true })
          counter.ingestSSEChunk(text)
        }
        controller.close()
      } catch {
        // Upstream errored — close gracefully
        try { controller.close() } catch { /* already closed */ }
      } finally {
        clearTimeout(inactivityTimer)
        clearTimeout(durationTimer)
        finish()
      }
    },
    cancel() {
      // Client disconnected — cancel upstream to stop inference and free resources
      reader?.cancel('client disconnected').catch(() => {})
      clearTimeout(inactivityTimer)
      clearTimeout(durationTimer)
      finish()
    },
  })

  return { readable }
}
