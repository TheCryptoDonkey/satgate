interface UsageData {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

/**
 * Counts tokens from OpenAI-compatible responses.
 *
 * Priority:
 * 1. Buffered usage (from non-streaming JSON response)
 * 2. Usage from final SSE chunk (stream_options: { include_usage: true })
 * 3. Content chunk count (fallback - 1 chunk ~= 1 token)
 */
export class TokenCounter {
  private bufferedUsage: UsageData | null = null
  private sseUsage: UsageData | null = null
  private contentChunkCount = 0

  /** Set usage from a buffered (non-streaming) JSON response. */
  setBufferedUsage(usage: Record<string, unknown>): void {
    this.bufferedUsage = {
      prompt_tokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
      completion_tokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
      total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
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
        if (parsed.usage) {
          this.sseUsage = {
            prompt_tokens: parsed.usage.prompt_tokens,
            completion_tokens: parsed.usage.completion_tokens,
            total_tokens: parsed.usage.total_tokens,
          }
        }

        // Count content chunks
        const choices = parsed.choices
        if (Array.isArray(choices)) {
          for (const choice of choices) {
            if (choice.delta?.content !== undefined && choice.delta.content !== '') {
              this.contentChunkCount++
            }
          }
        }
      } catch {
        // Malformed JSON - skip
      }
    }
  }

  /** Returns the final token count using the best available source. */
  finalCount(): number {
    // Priority 1: buffered usage
    if (this.bufferedUsage) {
      return this.extractTotal(this.bufferedUsage)
    }

    // Priority 2: SSE usage from final chunk
    if (this.sseUsage) {
      return this.extractTotal(this.sseUsage)
    }

    // Priority 3: chunk count fallback
    return this.contentChunkCount
  }

  private extractTotal(usage: UsageData): number {
    if (typeof usage.total_tokens === 'number') return usage.total_tokens
    const prompt = usage.prompt_tokens ?? 0
    const completion = usage.completion_tokens ?? 0
    return prompt + completion
  }
}
