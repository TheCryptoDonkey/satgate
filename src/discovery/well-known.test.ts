import { describe, it, expect } from 'vitest'
import { generateWellKnown, type WellKnownInput } from './well-known.js'

const input: WellKnownInput = {
  pricing: { default: 1, models: { llama3: 2, 'deepseek-r1': 5 } },
  models: ['llama3', 'deepseek-r1'],
  tiers: [{ amountSats: 1000, creditSats: 1000, label: '1k' }],
  paymentMethods: ['lightning', 'cashu'],
}

describe('generateWellKnown', () => {
  it('generates valid JSON with pricing', () => {
    const result = generateWellKnown(input)
    expect(result.version).toBe(1)
    expect(result.pricing.models.llama3.perThousandTokens).toBe(2)
    expect(result.pricing.default.perThousandTokens).toBe(1)
  })

  it('includes all endpoints', () => {
    const result = generateWellKnown(input)
    const paths = result.endpoints.map((e: any) => e.path)
    expect(paths).toContain('/v1/chat/completions')
    expect(paths).toContain('/v1/completions')
    expect(paths).toContain('/v1/embeddings')
  })

  it('includes payment tiers', () => {
    const result = generateWellKnown(input)
    expect(result.payment.tiers).toHaveLength(1)
    expect(result.payment.tiers[0].amountSats).toBe(1000)
  })

  it('lists models in capabilities', () => {
    const result = generateWellKnown(input)
    expect(result.capabilities.models).toEqual(['llama3', 'deepseek-r1'])
  })
})
