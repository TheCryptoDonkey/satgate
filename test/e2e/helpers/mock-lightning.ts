// test/e2e/helpers/mock-lightning.ts
import { createHash, randomBytes } from 'node:crypto'
import { bech32 } from '@scure/base'
import type { LightningBackend, Invoice, InvoiceStatus } from '@forgesworn/toll-booth'

function numberWords(value: number): number[] {
  const words: number[] = []
  let remaining = BigInt(value)
  do {
    words.unshift(Number(remaining % 32n))
    remaining /= 32n
  } while (remaining > 0n)
  return words
}

function taggedField(type: number, words: number[]): number[] {
  return [type, Math.floor(words.length / 32), words.length % 32, ...words]
}

function encodeBolt11(opts: {
  paymentHash: string
  amountSats: number
  expiry: number
  description?: string
}): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const timestampWords = Array.from({ length: 7 }, (_, index) =>
    Number((BigInt(timestamp) >> BigInt((6 - index) * 5)) & 31n),
  )
  const paymentHashWords = bech32.toWords(Uint8Array.from(Buffer.from(opts.paymentHash, 'hex')))
  const descriptionWords = bech32.toWords(new TextEncoder().encode(opts.description ?? 'satgate test invoice'))
  const data = [
    ...timestampWords,
    ...taggedField(1, paymentHashWords),
    ...taggedField(13, descriptionWords),
    ...taggedField(6, numberWords(opts.expiry)),
    ...Array<number>(104).fill(0),
  ]

  // The settlement path decodes and validates invoice commitments but does not
  // verify the payee signature. A zeroed signature keeps this fixture small and
  // deterministic without pulling a vulnerable signing package into the suite.
  return bech32.encode(`lnbc${opts.amountSats * 10}n`, data, 5_000)
}

export interface MockLightningResult {
  backend: LightningBackend
  /** Map from BOLT11 invoice string → preimage hex. Shared with mock wallet. */
  preimageMap: Map<string, string>
}

/**
 * Creates a mock Lightning backend that:
 * 1. Generates valid BOLT11 invoices (decodable by bolt11 library)
 * 2. Auto-settles invoices immediately via storage.settleWithCredit()
 * 3. Shares preimages via the returned preimageMap
 */
export function createMockLightning(storage: {
  settleWithCredit: (paymentHash: string, amount: number, settlementSecret?: string) => boolean
  isSettled: (paymentHash: string) => boolean
  getSettlementSecret: (paymentHash: string) => string | undefined
}): MockLightningResult {
  const preimageMap = new Map<string, string>()

  const backend: LightningBackend = {
    async createInvoice(amountSats: number, _memo?: string): Promise<Invoice> {
      const preimage = randomBytes(32)
      const paymentHash = createHash('sha256').update(preimage).digest('hex')
      const bolt11 = encodeBolt11({ paymentHash, amountSats, expiry: 3600 })

      preimageMap.set(bolt11, preimage.toString('hex'))
      storage.settleWithCredit(paymentHash, amountSats, preimage.toString('hex'))

      return { bolt11, paymentHash }
    },

    async checkInvoice(paymentHash: string): Promise<InvoiceStatus> {
      return {
        paid: storage.isSettled(paymentHash),
        preimage: storage.getSettlementSecret(paymentHash),
      }
    },
  }

  return { backend, preimageMap }
}

/**
 * Creates a mock payInvoice function matching FetchDeps.payInvoice signature.
 * Looks up preimages from the shared map populated by createMockLightning.
 */
export function createMockPayInvoice(preimageMap: Map<string, string>) {
  let callCount = 0

  const payInvoice = async (invoice: string) => {
    const preimage = preimageMap.get(invoice)
    if (!preimage) {
      return { paid: false as const, method: 'nwc' as const, reason: 'unknown invoice' }
    }
    callCount++
    return { paid: true as const, preimage, method: 'nwc' as const }
  }

  return { payInvoice, getCallCount: () => callCount }
}
