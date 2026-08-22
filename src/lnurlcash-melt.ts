import { fetchNoteInfo, meltNote } from 'lnurlcash-kit'
import type { ReceivedNote } from '@forgesworn/toll-booth'

/**
 * Sweeping a bearer note to the operator's node.
 *
 * The lnurlcash rail hands over a note this booth now owns, freshly
 * rotated, so nobody else knows the secret. That note is money sitting at
 * somebody else's mint, and an operator running a Lightning node would
 * rather have it at their own: melting is how it moves.
 *
 * The mint pays the invoice out of the note and covers routing from its own
 * fee, which is why the invoice is written for the note's whole value
 * rather than the value less a guess at what routing costs.
 */

export interface MeltNoteResult {
  paid: boolean
  amountSats: number
  /** Set when the mint said it was paying, and gave a way to prove it. */
  verify?: string
  error?: string
}

export interface MeltNoteOptions {
  note: ReceivedNote
  /** Makes an invoice on the operator's own node, and returns the bolt11. */
  createInvoice: (amountSats: number) => Promise<string>
  timeoutMs?: number
}

export async function meltNoteToLightning(options: MeltNoteOptions): Promise<MeltNoteResult> {
  const { note, createInvoice } = options
  const fetchOptions = options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }

  // A mint sends the whole-sat floor of whatever note it burns, so asking
  // for more than that would be asking for an amount it cannot pay.
  const amountSats = Math.floor(note.amountMsat / 1000)
  if (amountSats < 1) {
    return { paid: false, amountSats: 0, error: 'note is worth less than a sat' }
  }

  try {
    // The URL says where the note lives; the mint says where mutations go.
    const info = await fetchNoteInfo(note.url, fetchOptions)
    const invoice = await createInvoice(amountSats)
    const result = await meltNote(info.callback, note.k1, invoice, fetchOptions)
    return {
      paid: true,
      amountSats,
      ...(result.verify ? { verify: result.verify } : {}),
    }
  } catch (err) {
    // The note is not lost when this fails: it is still a note, and the
    // caller still holds its secret. Only the sweep did not happen.
    return {
      paid: false,
      amountSats,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
