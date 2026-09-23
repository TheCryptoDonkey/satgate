import type { StorageBackend } from '@forgesworn/toll-booth'

/**
 * What one proxied request has been charged, and how that charge can move.
 *
 * toll-booth takes the route price before the request reaches the proxy.
 * A hold carries that amount for this one request, so concurrent requests
 * on the same credential each settle their own charge instead of sharing
 * toll-booth's per-payment-hash estimate (which the last request to start
 * overwrites).
 */
export interface Hold {
  /** Sats (or cents, for a USD credential) taken so far for this request. */
  readonly held: number
  /**
   * True when the hold is denominated in sats and can be settled against a
   * token count. False for unmetered requests and USD credentials.
   */
  readonly metered: boolean
  /**
   * The most this request may cost when the hold cannot grow (a per-request
   * payment, a session, the free tier). Undefined when it can grow, or when
   * the request is unmetered.
   */
  readonly ceiling: number | undefined
  /** Grow the hold to `total`. Returns false when the credential cannot cover it. */
  reserve(total: number): boolean
  /** Charge `actual` in total and release the rest of the hold. Only the first call counts. */
  settle(actual: number): void
}

/** No payment behind the request (open or allowlist auth, or an unpriced route). */
export function unmeteredHold(): Hold {
  return { held: 0, metered: false, ceiling: undefined, reserve: () => true, settle: () => {} }
}

/**
 * A fixed amount that was paid for this request alone: an IETF Payment
 * charge, a session deduction or a free-tier allowance. It cannot grow, and
 * toll-booth offers no way to hand any of it back.
 */
export function fixedHold(amount: number): Hold {
  return {
    held: amount,
    metered: true,
    ceiling: amount,
    reserve: (total) => total <= amount,
    settle: () => {},
  }
}

/**
 * A draw on a prepaid credit balance (L402, Cashu, LNURLcash). The hold
 * grows by debiting the balance, and settling refunds whatever was held
 * beyond the actual cost.
 */
export function creditHold(storage: StorageBackend, paymentHash: string, initial: number): Hold {
  let held = initial
  let settled = false
  return {
    get held() { return held },
    metered: true,
    ceiling: undefined,
    reserve(total) {
      if (settled) return false
      const extra = total - held
      if (extra <= 0) return true
      if (!storage.debit(paymentHash, extra).success) return false
      held = total
      return true
    },
    settle(actual) {
      if (settled) return
      settled = true
      const delta = held - Math.max(0, actual)
      if (delta !== 0) storage.adjustCredits(paymentHash, delta)
    },
  }
}

/**
 * A USD credential (x402, or Cashu in a USD unit). Token prices are in sats,
 * so the route price stands as a flat charge; the hold is only refunded when
 * the request fails before any inference is served.
 */
export function usdHold(storage: StorageBackend, paymentHash: string, amount: number, refundable: boolean): Hold {
  let settled = false
  return {
    held: amount,
    metered: false,
    ceiling: undefined,
    reserve: () => true,
    settle(actual) {
      if (settled) return
      settled = true
      if (actual === 0 && refundable && amount > 0) storage.adjustCredits(paymentHash, amount, 'usd')
    },
  }
}

/**
 * Adapts the older reconcile callback (toll-booth's engine.reconcile, or a
 * test double) to a hold. Used when the caller supplies no hold.
 */
export function reconcileHold(
  reconcile: (paymentHash: string, actualCost: number) => unknown,
  paymentHash: string,
): Hold {
  let settled = false
  return {
    held: 0,
    metered: true,
    ceiling: undefined,
    reserve: () => true,
    settle(actual) {
      if (settled) return
      settled = true
      reconcile(paymentHash, actual)
    },
  }
}
