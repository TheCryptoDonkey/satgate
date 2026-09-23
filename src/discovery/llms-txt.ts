import type { ModelPricing } from '../config.js'
import { resolveModelPrice } from '../proxy/pricing.js'

export interface LlmsTxtInput {
  pricing: ModelPricing
  models: string[]
  /** Lightning backend in use (phoenixd, lnbits, lnd, cln, nwc), if any. */
  lightning?: string
  /** Flat per-request price in sats; when set, per-token prices are not shown. */
  flatPriceSats?: number
  x402?: { network: string }
  cashu?: boolean
  lnurlcash?: boolean
  ietfPayment?: boolean
}

function sats(n: number): string {
  return `${n} ${n === 1 ? 'sat' : 'sats'}`
}

export function generateLlmsTxt(input: LlmsTxtInput): string {
  const modelLines = input.models.map((model) => input.flatPriceSats !== undefined
    ? `- ${model}`
    : `- ${model} (${sats(resolveModelPrice(input.pricing, model))} / 1k tokens)`)

  const methods = [
    input.lightning ? 'Lightning' : '',
    input.cashu ? 'Cashu ecash' : '',
    input.lnurlcash ? 'LNURLcash (LUD-25) bearer notes' : '',
    input.x402 ? `x402 stablecoins (${input.x402.network})` : '',
  ].filter(Boolean)

  const schemes = [
    input.lightning ? 'L402 (credit-based: pay once, spend the balance over many requests)' : '',
    input.lightning && input.ietfPayment ? 'IETF Payment (per-request, draft-ryan-httpauth-payment-01)' : '',
  ].filter(Boolean)

  const pricingLine = input.flatPriceSats !== undefined
    ? `Each request costs a flat ${sats(input.flatPriceSats)}.`
    : 'Requests are billed per token (prompt + completion) at the rates above. The worst case for max_tokens is held up front and the unused part refunded once the upstream reports usage.'

  return `# satgate - Lightning-paid AI inference

> This endpoint provides OpenAI-compatible inference behind HTTP 402 payments.
> ${methods.length > 0 ? `Pay with ${methods.join(', ')}.` : 'No payment rails are configured.'} No account required.

## Available Models
${modelLines.join('\n')}

## Pricing
${pricingLine}

## Payment Schemes
${schemes.length > 0 ? schemes.map(s => `- ${s}`).join('\n') : '- None (no Lightning backend configured)'}

When payment is needed, the server returns HTTP 402 with a challenge for each scheme it accepts. Clients can choose any of them.

## Usage
Send standard OpenAI-compatible requests to /v1/chat/completions, /v1/completions or /v1/embeddings.
The first request returns 402 with payment details. Pay, then retry with your credential:
${input.lightning ? '- L402: Authorization: L402 <macaroon>:<preimage>\n' : ''}${input.lightning && input.ietfPayment ? '- IETF Payment: Authorization: Payment <base64url credential>\n' : ''}${input.cashu ? '- Cashu: X-Cashu: <cashuB token>\n' : ''}${input.lnurlcash ? '- LNURLcash: X-LNURLcash: <note URL>\n' : ''}${input.x402 ? '- x402: PAYMENT-SIGNATURE header\n' : ''}
${input.lightning ? `## Buying credit
POST /create-invoice to get a Lightning invoice for credit up front.
` : ''}${input.lightning && input.ietfPayment ? `
## IETF Payment Authentication
Implements draft-ryan-httpauth-payment-01 with the lightning payment method.
See: https://github.com/forgesworn/payment-methods
` : ''}`
}
