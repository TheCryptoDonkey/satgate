import { TokenCounter } from './token-counter.js'

/**
 * Creates a TransformStream that pipes SSE chunks through while counting tokens.
 *
 * @param upstream - The upstream SSE ReadableStream
 * @param onComplete - Called with the final token count after the stream ends
 * @returns An object with the readable side of the transform stream
 */
export function createStreamingProxy(
  upstream: ReadableStream<Uint8Array>,
  onComplete: (tokenCount: number) => void,
): { readable: ReadableStream<Uint8Array> } {
  const counter = new TokenCounter()
  const decoder = new TextDecoder()
  let completed = false

  function finish() {
    if (completed) return
    completed = true
    onComplete(counter.finalCount())
  }

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      const text = decoder.decode(chunk, { stream: true })
      counter.ingestSSEChunk(text)
    },
    flush() {
      finish()
    },
  })

  upstream.pipeTo(transform.writable).catch(() => {
    // Upstream errored before flush — still release resources (capacity slots, reconciliation).
    finish()
  })

  return { readable: transform.readable }
}
