import { describe, it, expect } from 'vitest'
import { TokenCounter } from './token-counter.js'

describe('TokenCounter', () => {
  describe('buffered JSON response', () => {
    it('uses prompt_tokens + completion_tokens from usage', () => {
      const counter = new TokenCounter()
      counter.setBufferedUsage({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      })
      expect(counter.finalCount()).toBe(150)
    })

    it('handles missing completion_tokens gracefully', () => {
      const counter = new TokenCounter()
      counter.setBufferedUsage({ prompt_tokens: 100 })
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
      // 2 chunks, but byte floor = ceil(11/4) = 3 (prevents single-chunk manipulation)
      expect(counter.finalCount()).toBe(3)
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
      // Should bill: prompt(10) + max(content_chunks(1), byte_floor(ceil(6/4)=2)) = 12, NOT total_tokens(60)
      expect(counter.finalCount()).toBe(12)
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

    it('prefers SSE completion_tokens over chunk count when no reasoning', () => {
      const counter = new TokenCounter()
      // Upstream sends one large content chunk (adversarial)
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":"Hello world this is a long response"}}]}\n\n')
      counter.ingestSSEChunk('data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":8,"total_tokens":18}}\n\n')
      counter.ingestSSEChunk('data: [DONE]\n\n')
      // Should use completion_tokens (8), not chunk count (1)
      expect(counter.finalCount()).toBe(18)
    })

    it('falls back to chunk count when reasoning chunks detected', () => {
      const counter = new TokenCounter()
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"reasoning":"thinking..."}}]}\n\n')
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":"answer"}}]}\n\n')
      counter.ingestSSEChunk('data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":50,"total_tokens":60}}\n\n')
      counter.ingestSSEChunk('data: [DONE]\n\n')
      // Should use max(chunk_count(1), byte_floor(ceil(6/4)=2)) not completion_tokens (50) — reasoning excluded
      expect(counter.finalCount()).toBe(12)
    })

    it('handles multi-event chunks', () => {
      const counter = new TokenCounter()
      const multiChunk =
        'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"b"}}]}\n\n'
      counter.ingestSSEChunk(multiChunk)
      expect(counter.finalCount()).toBe(2)
    })

    it('applies byte-based floor to prevent single-chunk manipulation', () => {
      const counter = new TokenCounter()
      // Single chunk with a long response (40 bytes) — without usage data
      counter.ingestSSEChunk('data: {"choices":[{"delta":{"content":"This is a long response with many tokens"}}]}\n\n')
      counter.ingestSSEChunk('data: [DONE]\n\n')
      // chunk_count = 1, byte_floor = ceil(40/4) = 10, max(1, 10) = 10
      expect(counter.finalCount()).toBe(10)
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
