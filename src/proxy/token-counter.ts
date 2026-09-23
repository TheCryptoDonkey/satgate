interface UsageData {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

/** A usage figure, if it is a non-negative finite number; otherwise undefined. */
function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.ceil(value) : undefined
}

/**
 * Counts tokens from OpenAI-compatible responses.
 *
 * Priority:
 * 1. Buffered usage (from non-streaming JSON response)
 * 2. Usage from final SSE chunk (stream_options: { include_usage: true })
 * 3. Generated chunk count (fallback - 1 chunk ~= 1 token, with a byte floor)
 */
export class TokenCounter {
  private bufferedUsage: UsageData | null = null
  private sseUsage: UsageData | null = null
  private contentChunkCount = 0
  private totalContentBytes = 0

  /** Set usage from a buffered (non-streaming) JSON response. */
  setBufferedUsage(usage: Record<string, unknown>): void {
    this.bufferedUsage = {
      prompt_tokens: tokenCount(usage.prompt_tokens),
      completion_tokens: tokenCount(usage.completion_tokens),
      total_tokens: tokenCount(usage.total_tokens),
    }
  }

  /** Ingest an SSE chunk (may contain multiple events). */
  ingestSSEChunk(chunk: string): void {
    const lines = chunk.split('\n')
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)

        // Check for usage in this chunk
        if (parsed.usage && typeof parsed.usage === 'object') {
          this.sseUsage = {
            prompt_tokens: tokenCount(parsed.usage.prompt_tokens),
            completion_tokens: tokenCount(parsed.usage.completion_tokens),
            total_tokens: tokenCount(parsed.usage.total_tokens),
          }
        }

        // Count generated chunks (content and reasoning). Only used when the
        // upstream reports no usage, as a floor-backed estimate.
        const choices = parsed.choices
        if (Array.isArray(choices)) {
          for (const choice of choices) {
            for (const field of ['content', 'reasoning', 'reasoning_content'] as const) {
              const text = choice.delta?.[field]
              if (typeof text === 'string' && text !== '') {
                this.contentChunkCount++
                this.totalContentBytes += new TextEncoder().encode(text).byteLength
              }
            }
          }
        }
      } catch {
        // Malformed JSON - skip
      }
    }
  }

  /** Returns the final token count using the best available source.
   *
   *  Reported usage wins: prompt_tokens + completion_tokens. Completion tokens
   *  include any reasoning/thinking tokens, which the upstream generated and
   *  the operator paid for in compute, so they are billed like any other.
   *
   *  Without reported usage (upstream ignored include_usage), the completion
   *  is estimated from generated chunks with a byte-based floor. */
  finalCount(): number {
    // Buffered response: use reported usage directly (no chunks to count)
    if (this.bufferedUsage) {
      const prompt = this.bufferedUsage.prompt_tokens ?? 0
      const completion = this.bufferedUsage.completion_tokens ?? 0
      return prompt + completion
    }

    // Streaming response
    const usage = this.sseUsage
    const promptTokens = usage?.prompt_tokens ?? 0
    if (usage?.completion_tokens !== undefined) {
      return promptTokens + usage.completion_tokens
    }

    // Byte-based floor: ~4 bytes per token is a conservative estimate.
    // Prevents a malicious upstream from bundling all content in one chunk to avoid billing.
    const byteFloor = Math.ceil(this.totalContentBytes / 4)
    return promptTokens + Math.max(this.contentChunkCount, byteFloor)
  }
}
