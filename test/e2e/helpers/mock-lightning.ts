// test/e2e/helpers/mock-lightning.ts
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import type { LightningBackend, Invoice, InvoiceStatus } from '@forgesworn/toll-booth'

const require = createRequire(import.meta.url)
const bolt11Lib = require('bolt11') as typeof import('bolt11')

// Fixed test-only private key (not a real node, just needs valid BOLT11 signatures)
const TEST_PRIVATE_KEY = randomBytes(32)

function encodeBolt11(opts: {
  paymentHash: string
  amountSats: number
  expiry: number
  description?: string
}): string {
  const encoded = bolt11Lib.encode({
    satoshis: opts.amountSats,
    timestamp: Math.floor(Date.now() / 1000),
    tags: [
      { tagName: 'payment_hash', data: opts.paymentHash },
      { tagName: 'description', data: opts.description ?? 'satgate test invoice' },
      { tagName: 'expire_time', data: opts.expiry },
    ],
  })
  const signed = bolt11Lib.sign(encoded, TEST_PRIVATE_KEY)
  if (!signed.paymentRequest) throw new Error('bolt11 sign failed to produce paymentRequest')
  return signed.paymentRequest
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
