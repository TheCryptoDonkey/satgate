import { describe, it, expect } from 'vitest'
import { resolveModelPrice, tokenCostToSats } from './pricing.js'
import type { ModelPricing } from '../config.js'

const pricing: ModelPricing = {
  default: 1,
  models: {
    llama3: 2,
    'deepseek-r1': 5,
    'mixtral-8x22b': 3,
  },
}

describe('resolveModelPrice', () => {
  it('returns exact match', () => {
    expect(resolveModelPrice(pricing, 'llama3')).toBe(2)
  })

  it('returns case-insensitive match', () => {
    expect(resolveModelPrice(pricing, 'Llama3')).toBe(2)
    expect(resolveModelPrice(pricing, 'DEEPSEEK-R1')).toBe(5)
  })

  it('strips Ollama tags (model:tag)', () => {
    expect(resolveModelPrice(pricing, 'llama3:latest')).toBe(2)
    expect(resolveModelPrice(pricing, 'deepseek-r1:70b')).toBe(5)
  })

  it('returns default for unknown model', () => {
    expect(resolveModelPrice(pricing, 'unknown-model')).toBe(1)
  })

  it('returns default for empty model name', () => {
    expect(resolveModelPrice(pricing, '')).toBe(1)
  })
})

describe('tokenCostToSats', () => {
  it('converts tokens to sats using ceil', () => {
    expect(tokenCostToSats(1000, 2)).toBe(2)
    expect(tokenCostToSats(1500, 2)).toBe(3)
    expect(tokenCostToSats(1, 1)).toBe(1)
    expect(tokenCostToSats(500, 1)).toBe(1)
  })

  it('returns 0 for zero tokens', () => {
    expect(tokenCostToSats(0, 2)).toBe(0)
  })

  it('handles fractional results with ceil', () => {
    expect(tokenCostToSats(1001, 1)).toBe(2)
  })

  it('returns 0 for negative or zero price', () => {
    expect(tokenCostToSats(100, -5)).toBe(0)
    expect(tokenCostToSats(100, 0)).toBe(0)
  })

  it('returns 0 for negative tokens', () => {
    expect(tokenCostToSats(-100, 2)).toBe(0)
  })
})
