import { describe, it, expect, vi } from 'vitest'
import { createStreamingProxy } from './streaming.js'

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const chunks: string[] = []
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(decoder.decode(value, { stream: true }))
  }
  return chunks.join('')
}

function makeSSEStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event))
      }
      controller.close()
    },
  })
}

describe('createStreamingProxy', () => {
  it('pipes all chunks through to output', async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ]
    const onComplete = vi.fn()
    const { readable } = createStreamingProxy(makeSSEStream(events), onComplete)
    const output = await collectStream(readable)
    expect(output).toContain('Hello')
    expect(output).toContain('world')
  })

  it('calls onComplete with token count after stream ends', async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"b"}}]}\n\n',
      'data: [DONE]\n\n',
    ]
    const onComplete = vi.fn()
    const { readable } = createStreamingProxy(makeSSEStream(events), onComplete)
    await collectStream(readable)
    expect(onComplete).toHaveBeenCalledWith(2)
  })

  it('uses prompt_tokens from usage + content chunk count', async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":20,"total_tokens":42}}\n\n',
      'data: [DONE]\n\n',
    ]
    const onComplete = vi.fn()
    const { readable } = createStreamingProxy(makeSSEStream(events), onComplete)
    await collectStream(readable)
    // prompt_tokens(20) + content_chunks(1) = 21, not total_tokens(42)
    expect(onComplete).toHaveBeenCalledWith(21)
  })

  it('handles empty stream', async () => {
    const events = ['data: [DONE]\n\n']
    const onComplete = vi.fn()
    const { readable } = createStreamingProxy(makeSSEStream(events), onComplete)
    await collectStream(readable)
    expect(onComplete).toHaveBeenCalledWith(0)
  })

  it('calls onComplete even when upstream stream errors', async () => {
    const errorStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'))
        controller.error(new Error('upstream died'))
      },
    })
    const onComplete = vi.fn()
    const { readable } = createStreamingProxy(errorStream, onComplete)

    // The readable side will error, but onComplete should still fire
    try {
      await collectStream(readable)
    } catch {
      // expected
    }

    // Give the catch handler time to fire
    await new Promise((r) => setTimeout(r, 50))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('calls onComplete exactly once on normal completion', async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: [DONE]\n\n',
    ]
    const onComplete = vi.fn()
    const { readable } = createStreamingProxy(makeSSEStream(events), onComplete)
    await collectStream(readable)
    // Small delay to ensure no double-call from catch
    await new Promise((r) => setTimeout(r, 50))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('times out on inactive upstream stream', async () => {
    const onComplete = vi.fn()
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'))
        // Never sends more data or closes — simulates a stalled upstream
      },
    })

    const { readable } = createStreamingProxy(upstream, onComplete, 100) // 100ms timeout
    await collectStream(readable)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith(1)
  })

  it('closes stream when cumulative size limit is exceeded', async () => {
    const onComplete = vi.fn()
    const encoder = new TextEncoder()
    const bigChunk = 'data: {"choices":[{"delta":{"content":"' + 'x'.repeat(500) + '"}}]}\n\n'
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Each chunk is ~530 bytes, limit is 1000 — second chunk should trigger close
        controller.enqueue(encoder.encode(bigChunk))
        controller.enqueue(encoder.encode(bigChunk))
        controller.enqueue(encoder.encode(bigChunk))
        controller.close()
      },
    })

    const { readable } = createStreamingProxy(upstream, onComplete, 120_000, 1000)
    const output = await collectStream(readable)
    expect(onComplete).toHaveBeenCalledTimes(1)
    // Should have received at most 2 chunks (first passes, second exceeds limit)
    expect(output.length).toBeLessThan(bigChunk.length * 3)
  })
})
