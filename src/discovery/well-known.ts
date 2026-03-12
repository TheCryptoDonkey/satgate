import type { ModelPricing } from '../config.js'

export interface WellKnownInput {
  pricing: ModelPricing
  models: string[]
  tiers: Array<{ amountSats: number; creditSats: number; label: string }>
  paymentMethods: string[]
}

export function generateWellKnown(input: WellKnownInput): Record<string, any> {
  const modelPricing: Record<string, { perThousandTokens: number }> = {}
  for (const [model, price] of Object.entries(input.pricing.models)) {
    modelPricing[model] = { perThousandTokens: price }
  }

  return {
    version: 1,
    name: 'Token Toll',
    description: 'Lightning-paid AI inference',
    pricing: {
      unit: 'tokens',
      currency: 'SAT',
      models: modelPricing,
      default: { perThousandTokens: input.pricing.default },
    },
    endpoints: [
      { path: '/v1/chat/completions', method: 'POST', description: 'Chat completions (OpenAI-compatible)' },
      { path: '/v1/completions', method: 'POST', description: 'Text completions (legacy)' },
      { path: '/v1/embeddings', method: 'POST', description: 'Embeddings' },
    ],
    payment: {
      methods: input.paymentMethods,
      createInvoice: '/create-invoice',
      tiers: input.tiers.map(t => ({ amountSats: t.amountSats, creditSats: t.creditSats })),
    },
    capabilities: {
      streaming: true,
      models: input.models,
    },
  }
}
