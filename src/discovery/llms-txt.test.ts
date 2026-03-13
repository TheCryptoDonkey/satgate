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
})
