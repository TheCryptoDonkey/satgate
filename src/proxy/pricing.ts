import type { ModelPricing } from '../config.js'

/**
 * The name a model is known by for matching: lower-cased, with Ollama's
 * implicit `:latest` tag made explicit (`llama3` and `llama3:latest` are
 * the same model to Ollama).
 */
export function canonicalModelName(model: string): string {
  const lower = model.trim().toLowerCase()
  return lower.includes(':') ? lower : `${lower}:latest`
}

/**
 * Whether a requested model is one this gateway serves: one the upstream
 * listed, or one the operator priced. Matching is by canonical name only,
 * so an alias the upstream would resolve to a priced model (for example
 * `registry.ollama.ai/library/gemma3:4b`) cannot be used to fall through
 * to the default price. An empty list means nothing is known, so nothing
 * is refused.
 */
export function isServedModel(model: string, served: readonly string[]): boolean {
  if (served.length === 0) return true
  if (!model) return false
  const wanted = canonicalModelName(model)
  return served.some(name => canonicalModelName(name) === wanted)
}

/**
 * Resolves the price per 1k tokens for a model.
 *
 * Resolution order:
 * 1. Exact match on model name
 * 2. Case-insensitive match, treating a missing tag as `:latest`
 * 3. Strip Ollama tag (model:tag -> model) and retry
 * 4. Fall back to default price
 */
export function resolveModelPrice(pricing: ModelPricing, model: string): number {
  if (!model) return pricing.default

  // Exact match (use hasOwn to avoid prototype property lookup)
  if (Object.hasOwn(pricing.models, model)) return pricing.models[model]

  // Case-insensitive match
  const lower = model.toLowerCase()
  for (const [key, value] of Object.entries(pricing.models)) {
    if (key.toLowerCase() === lower) return value
  }

  // Same model once the implicit :latest tag is spelt out
  const canonical = canonicalModelName(model)
  for (const [key, value] of Object.entries(pricing.models)) {
    if (canonicalModelName(key) === canonical) return value
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
