import { describe, it, expect } from 'vitest'
import { generateWellKnown } from '../../src/discovery/well-known.js'

const base = {
  pricing: { default: 1, models: { llama3: 2 } },
  models: ['llama3'],
  tiers: [{ amountSats: 1000, creditSats: 1000, label: '1k' }],
  paymentMethods: ['cashu'],
}

describe('well-known with Cashu', () => {
  it('includes cashu metadata when configured', () => {
    const result = generateWellKnown({
      ...base,
      cashu: { mints: ['https://mint.example.com'], unit: 'sat' },
    })
    expect(result.payment.cashu).toEqual({
      mints: ['https://mint.example.com'],
      unit: 'sat',
    })
  })

  it('omits cashu metadata when not configured', () => {
    const result = generateWellKnown(base)
    expect(result.payment.cashu).toBeUndefined()
  })

  it('includes cashu in payment methods list', () => {
    const result = generateWellKnown({
      ...base,
      cashu: { mints: ['https://mint.example.com'], unit: 'sat' },
    })
    expect(result.payment.methods).toContain('cashu')
  })
})
