import type { ModelPricing } from '../config.js'

/**
 * Resolves the price per 1k tokens for a model.
 *
 * Resolution order:
 * 1. Exact match on model name
 * 2. Case-insensitive match
 * 3. Strip Ollama tag (model:tag -> model) and retry
 * 4. Fall back to default price
 */
export function resolveModelPrice(pricing: ModelPricing, model: string): number {
  if (!model) return pricing.default

  // Exact match
  if (model in pricing.models) return pricing.models[model]

  // Case-insensitive match
  const lower = model.toLowerCase()
  for (const [key, value] of Object.entries(pricing.models)) {
    if (key.toLowerCase() === lower) return value
  }

  // Strip Ollama tag (e.g. llama3:latest -> llama3)
  const colonIdx = lower.indexOf(':')
  if (colonIdx !== -1) {
    const base = lower.slice(0, colonIdx)
    for (const [key, value] of Object.entries(pricing.models)) {
      if (key.toLowerCase() === base) return value
    }
  }

  return pricing.default
}

/**
 * Converts a token count to a sat cost.
 * Always rounds up (ceil) so the operator is never short-changed.
 */
export function tokenCostToSats(totalTokens: number, pricePerThousand: number): number {
  if (totalTokens <= 0 || pricePerThousand <= 0) return 0
  return Math.ceil(totalTokens * pricePerThousand / 1000)
}
