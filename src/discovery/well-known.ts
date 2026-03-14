import type { ModelPricing } from '../config.js'

export interface WellKnownInput {
  pricing: ModelPricing
  models: string[]
  tiers: Array<{ amountSats: number; creditSats: number; label: string }>
  paymentMethods: string[]
  freeTier?: { creditsPerDay: number }
  x402?: {
    receiverAddress: string
    network: string
    asset?: string
    facilitatorUrl?: string
  }
}

export function generateWellKnown(input: WellKnownInput): Record<string, any> {
  const modelPricing: Record<string, { perThousandTokens: number }> = {}
  for (const [model, price] of Object.entries(input.pricing.models)) {
    modelPricing[model] = { perThousandTokens: price }
  }

  const result: Record<string, any> = {
    version: 1,
    name: 'satgate',
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
    ...(input.freeTier && input.freeTier.creditsPerDay > 0 && {
      free_tier: { credits_per_day: input.freeTier.creditsPerDay },
    }),
  }

  if (input.x402) {
    result.payment.x402 = {
      receiver: input.x402.receiverAddress,
      network: input.x402.network,
      ...(input.x402.asset && { asset: input.x402.asset }),
      ...(input.x402.facilitatorUrl && { facilitator: input.x402.facilitatorUrl }),
    }
  }

  return result
}
