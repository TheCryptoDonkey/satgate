import type { X402Facilitator, X402Payment, X402VerifyResult } from '@thecryptodonkey/toll-booth'

export interface HttpFacilitatorConfig {
  facilitatorUrl: string
  facilitatorKey?: string
}

export function createHttpFacilitator(config: HttpFacilitatorConfig): X402Facilitator {
  return {
    async verify(payload: X402Payment): Promise<X402VerifyResult> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (config.facilitatorKey) {
        headers['Authorization'] = `Bearer ${config.facilitatorKey}`
      }

      const res = await fetch(config.facilitatorUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      })

      if (!res.ok) {
        return { valid: false, txHash: '', amount: 0, sender: '' }
      }

      const result = await res.json() as X402VerifyResult
      return result
    },
  }
}
