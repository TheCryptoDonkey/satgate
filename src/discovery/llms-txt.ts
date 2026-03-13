import type { ModelPricing } from '../config.js'

export interface LlmsTxtInput {
  pricing: ModelPricing
  models: string[]
  x402?: { network: string }
}

export function generateLlmsTxt(input: LlmsTxtInput): string {
  const modelLines = input.models.map((model) => {
    const price = input.pricing.models[model] ?? input.pricing.default
    const unit = price === 1 ? 'sat' : 'sats'
    return `- ${model} (${price} ${unit} / 1k tokens)`
  })

  return `# satgate - Lightning-paid AI inference

> This endpoint provides OpenAI-compatible inference behind L402 payments.
> Pay with Lightning or Cashu. No account required.

## Available Models
${modelLines.join('\n')}

## Usage
Send standard OpenAI-compatible requests to /v1/chat/completions.
First request returns 402 with a Lightning invoice.
Pay the invoice, then retry with the L402 credential.

## Payment
POST /create-invoice to get a Lightning invoice.
Supports Lightning, NWC, and Cashu.
${input.x402 ? `Also accepts x402 stablecoin payments (${input.x402.network} network).\n` : ''}`
}
