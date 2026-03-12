import { describe, it, expect } from 'vitest'
import { TokenCounter } from './token-counter.js'

describe('TokenCounter', () => {
  describe('buffered JSON response', () => {
    it('extracts total_tokens from usage', () => {
      const counter = new TokenCounter()
      counter.setBufferedUsage({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      })
      expect(counter.finalCount()).toBe(150)
    })

    it('sums prompt + completion if total_tokens missing', () => {
      const counter = new TokenCounter()
      counter.setBufferedUsage({
        prompt_tokens: 100,
        completion_tokens: 50,
      })
      expect(counter.finalCount()).toBe(150)
    })

    it('returns 0 for empty usage', () => {
      const counter = new TokenCounter()
      counter.setBufferedUsage({})
      expect(counter.finalCount()).toBe(0)
    })
  })

  describe('SSE chunk ingestion', () => {
    it('counts content chunks as fallback', () => {
      const counter = new TokenCounter()
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n')
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":" world"}}]}\n\n')
      counter.ingestSSEChunk('data: [DONE]\n\n')
      expect(counter.finalCount()).toBe(2)
    })

    it('extracts usage from final chunk (OpenAI format)', () => {
      const counter = new TokenCounter()
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')
      counter.ingestSSEChunk('data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":1,"total_tokens":11}}\n\n')
      counter.ingestSSEChunk('data: [DONE]\n\n')
      expect(counter.finalCount()).toBe(11)
    })

    it('ignores non-content chunks in count', () => {
      const counter = new TokenCounter()
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n')
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')
      counter.ingestSSEChunk('data: [DONE]\n\n')
      expect(counter.finalCount()).toBe(1)
    })

    it('handles malformed SSE data gracefully', () => {
      const counter = new TokenCounter()
      counter.ingestSSEChunk('data: not-json\n\n')
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n')
      expect(counter.finalCount()).toBe(1)
    })

    it('handles multi-event chunks', () => {
      const counter = new TokenCounter()
      const multiChunk =
        'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"b"}}]}\n\n'
      counter.ingestSSEChunk(multiChunk)
      expect(counter.finalCount()).toBe(2)
    })
  })

  describe('priority', () => {
    it('usage from final chunk beats chunk count', () => {
      const counter = new TokenCounter()
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":"a"}}]}\n\n')
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":"b"}}]}\n\n')
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":"c"}}]}\n\n')
      counter.ingestSSEChunk('data: {"choices":[],"usage":{"total_tokens":50}}\n\n')
      counter.ingestSSEChunk('data: [DONE]\n\n')
      expect(counter.finalCount()).toBe(50)
    })

    it('buffered usage beats SSE data', () => {
      const counter = new TokenCounter()
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":"a"}}]}\n\n')
      counter.setBufferedUsage({ total_tokens: 100 })
      expect(counter.finalCount()).toBe(100)
    })
  })
})
