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

      let res: Response
      try {
        res = await fetch(config.facilitatorUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        })
      } catch {
        return { valid: false, txHash: '', amount: 0, sender: '' }
      }

      if (!res.ok) {
        await res.body?.cancel().catch(() => {})
        return { valid: false, txHash: '', amount: 0, sender: '' }
      }

      // Read body incrementally with a 64 KiB size cap to prevent memory exhaustion
      const maxFacilitatorBytes = 64 * 1024
      const reader = res.body?.getReader()
      if (!reader) {
        return { valid: false, txHash: '', amount: 0, sender: '' }
      }
      const chunks: Uint8Array[] = []
      let totalBytes = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        totalBytes += value.byteLength
        if (totalBytes > maxFacilitatorBytes) {
          await reader.cancel('response too large').catch(() => {})
          return { valid: false, txHash: '', amount: 0, sender: '' }
        }
        chunks.push(value)
      }
      const bodyText = new TextDecoder().decode(Buffer.concat(chunks))
      let result: Record<string, unknown>
      try {
        result = JSON.parse(bodyText) as Record<string, unknown>
      } catch {
        return { valid: false, txHash: '', amount: 0, sender: '' }
      }
      // Validate response shape — don't trust arbitrary JSON from external facilitator
      if (typeof result !== 'object' || result === null) {
        return { valid: false, txHash: '', amount: 0, sender: '' }
      }
      return {
        valid: result.valid === true,
        txHash: typeof result.txHash === 'string' ? result.txHash : '',
        amount: typeof result.amount === 'number' ? result.amount : 0,
        sender: typeof result.sender === 'string' ? result.sender : '',
      }
    },
  }
}
