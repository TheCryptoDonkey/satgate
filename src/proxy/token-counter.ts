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
  private totalContentBytes = 0
  private hasReasoningChunks = false

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

        // Count content and reasoning chunks
        const choices = parsed.choices
        if (Array.isArray(choices)) {
          for (const choice of choices) {
            if (choice.delta?.content !== undefined && choice.delta.content !== '') {
              this.contentChunkCount++
              this.totalContentBytes += new TextEncoder().encode(choice.delta.content).byteLength
            }
            if (choice.delta?.reasoning !== undefined || choice.delta?.reasoning_content !== undefined) {
              this.hasReasoningChunks = true
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
   *  For buffered (non-streaming) responses, uses prompt_tokens + completion_tokens
   *  from the usage object since there are no SSE chunks to count.
   *
   *  For streaming responses, uses prompt_tokens + content chunk count.
   *  This avoids billing for reasoning/thinking tokens that some models produce. */
  finalCount(): number {
    // Buffered response — use reported usage directly (no chunks to count)
    if (this.bufferedUsage) {
      const prompt = this.bufferedUsage.prompt_tokens ?? 0
      const completion = this.bufferedUsage.completion_tokens ?? 0
      return prompt + completion
    }

    // Streaming response
    const usage = this.sseUsage
    const promptTokens = usage?.prompt_tokens ?? 0

    // Byte-based floor: ~4 bytes per token is a conservative estimate.
    // Prevents a malicious upstream from bundling all content in one chunk to avoid billing.
    const byteFloor = Math.ceil(this.totalContentBytes / 4)

    // If reasoning chunks were detected, use content chunk count to exclude them.
    // Otherwise, prefer completion_tokens from SSE usage (more accurate than chunk count).
    if (this.hasReasoningChunks) {
      const completionEstimate = Math.max(this.contentChunkCount, byteFloor)
      return promptTokens + completionEstimate
    }
    if (usage?.completion_tokens !== undefined) {
      return promptTokens + usage.completion_tokens
    }
    return promptTokens + Math.max(this.contentChunkCount, byteFloor)
  }
}
