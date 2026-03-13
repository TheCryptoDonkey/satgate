import { describe, it, expect } from 'vitest'
import { TokenCounter } from './token-counter.js'

describe('TokenCounter', () => {
  describe('buffered JSON response', () => {
    it('uses prompt_tokens from usage (no content chunks for buffered)', () => {
      const counter = new TokenCounter()
      counter.setBufferedUsage({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      })
      // No content chunks ingested, so finalCount = prompt_tokens + 0
      expect(counter.finalCount()).toBe(100)
    })

    it('returns 0 for empty usage', () => {
      const counter = new TokenCounter()
      counter.setBufferedUsage({})
      expect(counter.finalCount()).toBe(0)
    })
  })

  describe('SSE chunk ingestion', () => {
    it('counts content chunks (no usage stats)', () => {
      const counter = new TokenCounter()
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n')
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":" world"}}]}\n\n')
      counter.ingestSSEChunk('data: [DONE]\n\n')
      expect(counter.finalCount()).toBe(2)
    })

    it('uses prompt_tokens from usage + content chunk count', () => {
      const counter = new TokenCounter()
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')
      counter.ingestSSEChunk('data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":1,"total_tokens":11}}\n\n')
      counter.ingestSSEChunk('data: [DONE]\n\n')
      // prompt_tokens(10) + content_chunks(1) = 11
      expect(counter.finalCount()).toBe(11)
    })

    it('excludes reasoning tokens from billing', () => {
      const counter = new TokenCounter()
      // Reasoning chunks (not content)
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"reasoning":"thinking..."}}]}\n\n')
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"reasoning":"more thinking"}}]}\n\n')
      // Actual content
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":"Hello!"}}]}\n\n')
      // Usage includes all tokens (reasoning + content + prompt)
      counter.ingestSSEChunk('data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":50,"total_tokens":60}}\n\n')
      counter.ingestSSEChunk('data: [DONE]\n\n')
      // Should bill: prompt(10) + content_chunks(1) = 11, NOT total_tokens(60)
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
    it('prompt_tokens from usage + content chunks', () => {
      const counter = new TokenCounter()
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":"a"}}]}\n\n')
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":"b"}}]}\n\n')
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":"c"}}]}\n\n')
      counter.ingestSSEChunk('data: {"choices":[],"usage":{"prompt_tokens":20,"total_tokens":50}}\n\n')
      counter.ingestSSEChunk('data: [DONE]\n\n')
      // prompt(20) + content_chunks(3) = 23
      expect(counter.finalCount()).toBe(23)
    })
  })
})
