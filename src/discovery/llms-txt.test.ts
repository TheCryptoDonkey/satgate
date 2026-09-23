import { describe, it, expect } from 'vitest'
import { generateLlmsTxt, type LlmsTxtInput } from './llms-txt.js'

describe('generateLlmsTxt', () => {
  it('includes model names and pricing', () => {
    const text = generateLlmsTxt({
      pricing: { default: 1, models: { llama3: 2, 'deepseek-r1': 5 } },
      models: ['llama3', 'deepseek-r1'],
    })
    expect(text).toContain('llama3')
    expect(text).toContain('deepseek-r1')
    expect(text).toContain('2 sat')
    expect(text).toContain('5 sat')
  })

  it('includes usage instructions', () => {
    const text = generateLlmsTxt({
      pricing: { default: 1, models: {} },
      models: ['llama3'],
      lightning: 'phoenixd',
    })
    expect(text).toContain('/v1/chat/completions')
    expect(text).toContain('402')
    expect(text).toContain('L402')
  })

  it('mentions x402 when configured', () => {
    const text = generateLlmsTxt({
      pricing: { default: 1, models: {} },
      models: ['llama3'],
      x402: { network: 'base' },
    })
    expect(text).toContain('x402')
    expect(text).toContain('base')
  })

  it('names only the payment methods that are configured', () => {
    const lightningOnly = generateLlmsTxt({ pricing: { default: 1, models: {} }, models: [], lightning: 'phoenixd', ietfPayment: true })
    expect(lightningOnly).toContain('Pay with Lightning.')
    expect(lightningOnly).not.toMatch(/NWC|Cashu|LNURLcash|x402/)

    const cashuOnly = generateLlmsTxt({ pricing: { default: 1, models: {} }, models: [], cashu: true })
    expect(cashuOnly).toContain('Pay with Cashu ecash.')
    expect(cashuOnly).not.toContain('L402')
    expect(cashuOnly).not.toContain('/create-invoice')

    const everything = generateLlmsTxt({ pricing: { default: 1, models: {} }, models: [], lightning: 'nwc', cashu: true, lnurlcash: true, x402: { network: 'base' } })
    expect(everything).toContain('Lightning, Cashu ecash, LNURLcash (LUD-25) bearer notes, x402 stablecoins (base)')
  })

  it('shows the flat price instead of per-token rates in flat mode', () => {
    const text = generateLlmsTxt({ pricing: { default: 1, models: { llama3: 2 } }, models: ['llama3'], lightning: 'phoenixd', flatPriceSats: 3 })
    expect(text).toContain('flat 3 sats')
    expect(text).not.toContain('/ 1k tokens')
  })

  it('prices tagged models by their base entry', () => {
    const text = generateLlmsTxt({ pricing: { default: 1, models: { llama3: 4 } }, models: ['llama3:8b'] })
    expect(text).toContain('llama3:8b (4 sats / 1k tokens)')
  })
})
