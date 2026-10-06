import { AmbiguousMintError, classifyNoteError, lnurlFetch, meltNote } from '@lnurlcash/kit'
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
}

export interface NoteLookup {
  /** Where the mint takes mutations, melt among them. */
  callback: string
  /** What the mint says the note is worth, in millisats. */
  maxWithdrawable: number
}

/**
 * Asks the note's mint about it by its spend, `?k1=`.
 *
 * Every mint generation answers this. A mint from before LUD-25's unified
 * notes reads only `k1` on a lookup, while the kit's own `fetchNoteInfo`
 * now names a bearer note by its `cp1` as `p`, which such a mint does not
 * understand. A current mint takes `k1` too, and checks the spend in full.
 * The spend is no more exposed than the melt that follows exposes it.
 *
 * Whatever certificate the URL carries is left behind: the old `sig` (hex or
 * the fixed-HRP `cs1`) or the current `c` (`cs1<amount>`). A melt needs no
 * certificate, and the mint states the value itself, so a note in any of
 * those shapes is asked after the same way.
 */
export async function lookupNoteBySpend(noteUrl: string, k1: string): Promise<NoteLookup> {
  const url = new URL(noteUrl)
  url.searchParams.delete('sig')
  url.searchParams.delete('c')
  url.searchParams.delete('amount')
  url.searchParams.set('k1', k1)

  let body: unknown
  try {
    body = await lnurlFetch(url)
  } catch (err) {
    throw err instanceof AmbiguousMintError || !(err instanceof Error) ? err : classifyNoteError(err)
  }

  // Read loosely: a melt needs only the callback, and a mint with no signing
  // key of its own publishes no mintPubkey.
  const info = body as Record<string, unknown> | null
  if (
    info?.tag !== 'withdrawRequest' ||
    typeof info.callback !== 'string' ||
    typeof info.maxWithdrawable !== 'number' ||
    !Number.isFinite(info.maxWithdrawable) ||
    info.maxWithdrawable < 0
  ) {
    throw new Error('Not a withdrawRequest (unexpected response).')
  }
  // A mint that echoes a spend must echo this one.
  if (typeof info.k1 === 'string' && info.k1.toLowerCase() !== k1.toLowerCase()) {
    throw new Error('The mint answered for a different note than was asked about.')
  }
  return { callback: info.callback, maxWithdrawable: info.maxWithdrawable }
}

export async function meltNoteToLightning(options: MeltNoteOptions): Promise<MeltNoteResult> {
  const { note, createInvoice } = options

  // A mint sends the whole-sat floor of whatever note it burns, so asking
  // for more than that would be asking for an amount it cannot pay.
  const amountSats = Math.floor(note.amountMsat / 1000)
  if (amountSats < 1) {
    return { paid: false, amountSats: 0, error: 'note is worth less than a sat' }
  }

  try {
    // The URL says where the note lives; the mint says where mutations go.
    const { callback } = await lookupNoteBySpend(note.url, note.k1)
    const invoice = await createInvoice(amountSats)
    // The spend goes as it came, a bearer note's 64-hex preimage: the short
    // form every mint generation reads on a melt.
    const result = await meltNote(callback, note.k1, invoice)
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
