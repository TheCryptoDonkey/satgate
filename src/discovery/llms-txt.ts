import type { ModelPricing } from '../config.js'

export interface LlmsTxtInput {
  pricing: ModelPricing
  models: string[]
  x402?: { network: string }
  cashu?: boolean
  ietfPayment?: boolean
}

export function generateLlmsTxt(input: LlmsTxtInput): string {
  const modelLines = input.models.map((model) => {
    const price = input.pricing.models[model] ?? input.pricing.default
    const unit = price === 1 ? 'sat' : 'sats'
    return `- ${model} (${price} ${unit} / 1k tokens)`
  })

  const methods = ['Lightning', input.cashu ? 'Cashu ecash' : ''].filter(Boolean).join(' or ')

  const schemes = ['L402 (credit-based)', input.ietfPayment ? 'IETF Payment (per-request, draft-ryan-httpauth-payment-01)' : ''].filter(Boolean)

  return `# satgate - Lightning-paid AI inference

> This endpoint provides OpenAI-compatible inference behind Lightning payments.
> Pay with ${methods}. No account required.

## Available Models
${modelLines.join('\n')}

## Payment Schemes
This endpoint supports ${schemes.length > 1 ? 'dual-scheme challenges' : schemes[0]}:
${schemes.map(s => `- ${s}`).join('\n')}

When credits are exhausted, the server returns HTTP 402 with both schemes in the WWW-Authenticate header. Clients can choose either scheme.

## Usage
Send standard OpenAI-compatible requests to /v1/chat/completions.
First request returns 402 with a Lightning invoice.
Pay the invoice, then retry with your chosen credential:
- L402: Authorization: L402 <macaroon>:<preimage>
${input.ietfPayment ? '- IETF Payment: Authorization: Payment <base64url credential>\n' : ''}
## Payment
POST /create-invoice to get a Lightning invoice.
Supports Lightning${input.cashu ? ', Cashu ecash,' : ''} and NWC.
${input.x402 ? `Also accepts x402 stablecoin payments (${input.x402.network} network).\n` : ''}${input.ietfPayment ? `## IETF Payment Authentication
Implements draft-ryan-httpauth-payment-01 with the lightning payment method.
See: https://github.com/forgesworn/payment-methods\n` : ''}`
}
