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

  it('uses usage from final chunk when available', async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[],"usage":{"total_tokens":42}}\n\n',
      'data: [DONE]\n\n',
    ]
    const onComplete = vi.fn()
    const { readable } = createStreamingProxy(makeSSEStream(events), onComplete)
    await collectStream(readable)
    expect(onComplete).toHaveBeenCalledWith(42)
  })

  it('handles empty stream', async () => {
    const events = ['data: [DONE]\n\n']
    const onComplete = vi.fn()
    const { readable } = createStreamingProxy(makeSSEStream(events), onComplete)
    await collectStream(readable)
    expect(onComplete).toHaveBeenCalledWith(0)
  })

  it('calls onComplete when upstream errors mid-stream', async () => {
    const onComplete = vi.fn()
    const encoder = new TextEncoder()
    const upstream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'))
        // Delay slightly so the chunk is processed before error
        await new Promise(r => setTimeout(r, 10))
        controller.error(new Error('upstream died'))
      },
    })

    const { readable } = createStreamingProxy(upstream, onComplete)
    await collectStream(readable).catch(() => {})
    // Wait for the finally block
    await new Promise(r => setTimeout(r, 50))
    // The critical assertion: onComplete must be called (capacity released)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('calls onComplete only once even on multiple close paths', async () => {
    const onComplete = vi.fn()
    const events = [
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
      'data: [DONE]\n\n',
    ]
    const { readable } = createStreamingProxy(makeSSEStream(events), onComplete)
    await collectStream(readable)
    // Wait for any async callbacks
    await new Promise(r => setTimeout(r, 50))
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
})
