import { TokenCounter } from './token-counter.js'

/** Default inactivity timeout for streaming responses (2 minutes). */
const DEFAULT_INACTIVITY_TIMEOUT_MS = 120_000

/**
 * Creates a ReadableStream that pipes upstream SSE chunks through while counting tokens.
 *
 * @param upstream - The upstream SSE ReadableStream
 * @param onComplete - Called with the final token count after the stream ends or errors
 * @param inactivityTimeoutMs - Max time between chunks before aborting (default: 120s)
 * @returns An object with the readable side
 */
export function createStreamingProxy(
  upstream: ReadableStream<Uint8Array>,
  onComplete: (tokenCount: number) => void,
  inactivityTimeoutMs: number = DEFAULT_INACTIVITY_TIMEOUT_MS,
): { readable: ReadableStream<Uint8Array> } {
  const counter = new TokenCounter()
  const decoder = new TextDecoder()
  let completeCalled = false
  let inactivityTimer: ReturnType<typeof setTimeout> | undefined

  function callOnComplete() {
    if (completeCalled) return
    completeCalled = true
    clearTimeout(inactivityTimer)
    onComplete(counter.finalCount())
  }

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader()

      function resetTimer() {
        clearTimeout(inactivityTimer)
        inactivityTimer = setTimeout(() => {
          reader.cancel('inactivity timeout').catch(() => {})
          controller.close()
          callOnComplete()
        }, inactivityTimeoutMs)
      }

      resetTimer()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          resetTimer()
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
        callOnComplete()
      }
    },
    cancel() {
      // Client disconnected
      clearTimeout(inactivityTimer)
      callOnComplete()
    },
  })

  return { readable }
}
