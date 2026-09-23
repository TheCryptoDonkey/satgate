import { createHash, randomBytes } from 'node:crypto'
import type { LightningBackend } from '@forgesworn/toll-booth'

/**
 * A Lightning backend whose invoices are "paid" by looking up the preimage:
 * enough to drive the L402 flow end to end without a node.
 */
export function createPreimageBackend() {
  const preimages = new Map<string, string>()
  const backend: LightningBackend = {
    async createInvoice(amountSats: number) {
      const preimage = randomBytes(32)
      const paymentHash = createHash('sha256').update(preimage).digest('hex')
      preimages.set(paymentHash, preimage.toString('hex'))
      return { bolt11: `lnbc${amountSats}test${paymentHash.slice(0, 16)}`, paymentHash }
    },
    async checkInvoice(paymentHash: string) {
      return { paid: preimages.has(paymentHash), preimage: preimages.get(paymentHash) }
    },
  }
  return { backend, preimages }
}

type Fetchable = { request: (path: string, init?: RequestInit) => Response | Promise<Response> }

/** Triggers a 402 and returns a paid L402 Authorization header value. */
export async function buyL402Credential(app: Fetchable, preimages: Map<string, string>, path = '/v1/chat/completions'): Promise<string> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama3', messages: [] }),
  })
  if (res.status !== 402) throw new Error(`expected 402, got ${res.status}`)
  const body = await res.json() as { l402: { macaroon: string; payment_hash: string } }
  const preimage = preimages.get(body.l402.payment_hash)
  if (!preimage) throw new Error('no preimage for challenge invoice')
  return `L402 ${body.l402.macaroon}:${preimage}`
}

/** Triggers a 402 and returns a paid IETF Payment (charge intent) Authorization header value. */
export async function buyIetfCharge(app: Fetchable, preimages: Map<string, string>, path = '/v1/chat/completions'): Promise<string> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama3', messages: [] }),
  })
  if (res.status !== 402) throw new Error(`expected 402, got ${res.status}`)
  const header = res.headers.get('WWW-Authenticate') ?? ''
  const match = /Payment (id="[^"]+", realm="[^"]+", method="[^"]+", intent="[^"]+", request="[^"]+", expires="[^"]+")/.exec(header)
  if (!match) throw new Error('no IETF Payment challenge')
  const challenge: Record<string, string> = {}
  for (const [, key, value] of match[1].matchAll(/(\w+)="([^"]*)"/g)) challenge[key] = value
  const body = await res.json() as { ietf_payment: { payment_hash: string } }
  const preimage = preimages.get(body.ietf_payment.payment_hash)
  if (!preimage) throw new Error('no preimage for challenge invoice')
  return `Payment ${Buffer.from(JSON.stringify({ challenge, payload: { preimage } })).toString('base64url')}`
}
