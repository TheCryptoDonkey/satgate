# x402 Stablecoin Payments Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add x402 stablecoin payment support to toll-booth and token-toll, making toll-booth the first middleware that speaks both L402 (Bitcoin) and x402 (USDC).

**Architecture:** Refactor toll-booth's engine from hardcoded L402 to a pluggable `PaymentRail` interface. Extract existing L402 logic into an L402Rail, then add X402Rail alongside it. Engine becomes a rail-agnostic orchestrator that merges multi-rail 402 challenges. Dual-currency balance tracking (sats + USD cents) with no cross-currency mixing. token-toll inherits x402 via config.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, macaroon library, Hono (token-toll)

**Spec:** `docs/superpowers/specs/2026-03-12-x402-stablecoin-payments-design.md`

**Repos:**
- toll-booth: `/Users/darren/WebstormProjects/toll-booth`
- token-toll: `/Users/darren/WebstormProjects/token-toll`

---

## Chunk 1: PaymentRail Abstraction (toll-booth)

Pure refactor. No new features. All existing tests must pass unchanged.

### Task 1: Define PaymentRail interface and supporting types

**Files:**
- Create: `toll-booth/src/core/payment-rail.ts`
- Test: `toll-booth/src/core/payment-rail.test.ts`

- [ ] **Step 1: Write the type definitions**

Create `toll-booth/src/core/payment-rail.ts`:

```typescript
import type { TollBoothRequest } from './types.js'

export type Currency = 'sat' | 'usd'

export interface PriceInfo {
  sats?: number
  usd?: number
}

/** Accepts both number (backward-compat sats) and PriceInfo */
export type PricingEntry = number | PriceInfo

export type PricingTable = Record<string, PricingEntry>

/** Normalise a PricingEntry to PriceInfo. Numbers become { sats: n }. */
export function normalisePricing(entry: PricingEntry): PriceInfo {
  return typeof entry === 'number' ? { sats: entry } : entry
}

/** Normalise an entire PricingTable. */
export function normalisePricingTable(table: PricingTable): Record<string, PriceInfo> {
  const result: Record<string, PriceInfo> = {}
  for (const [route, entry] of Object.entries(table)) {
    result[route] = normalisePricing(entry)
  }
  return result
}

export interface ChallengeFragment {
  headers: Record<string, string>
  body: Record<string, unknown>
}

export interface RailVerifyResult {
  authenticated: boolean
  paymentId: string
  mode: 'per-request' | 'credit'
  creditBalance?: number
  currency: Currency
  customCaveats?: Record<string, string>
}

export interface SettleResult {
  settled: boolean
  txHash?: string
}

export interface PaymentRail {
  type: string
  creditSupported: boolean
  /** Returns true if this rail can generate a challenge for the given price. */
  canChallenge?(price: PriceInfo): boolean
  challenge(route: string, price: PriceInfo): Promise<ChallengeFragment>
  detect(req: TollBoothRequest): boolean
  verify(req: TollBoothRequest): Promise<RailVerifyResult> | RailVerifyResult
  settle?(paymentId: string, amount: number): Promise<SettleResult>
}
```

- [ ] **Step 2: Write tests for normalisePricing**

Create `toll-booth/src/core/payment-rail.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { normalisePricing, normalisePricingTable } from './payment-rail.js'

describe('normalisePricing', () => {
  it('converts number to sats-only PriceInfo', () => {
    expect(normalisePricing(50)).toEqual({ sats: 50 })
  })

  it('passes PriceInfo through unchanged', () => {
    expect(normalisePricing({ sats: 50, usd: 2 })).toEqual({ sats: 50, usd: 2 })
  })

  it('handles usd-only PriceInfo', () => {
    expect(normalisePricing({ usd: 5 })).toEqual({ usd: 5 })
  })

  it('handles zero', () => {
    expect(normalisePricing(0)).toEqual({ sats: 0 })
  })
})

describe('normalisePricingTable', () => {
  it('normalises mixed table', () => {
    const table = {
      '/api/a': 100,
      '/api/b': { sats: 50, usd: 2 },
      '/api/c': { usd: 5 },
    }
    expect(normalisePricingTable(table)).toEqual({
      '/api/a': { sats: 100 },
      '/api/b': { sats: 50, usd: 2 },
      '/api/c': { usd: 5 },
    })
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run src/core/payment-rail.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```
cd /Users/darren/WebstormProjects/toll-booth
git add src/core/payment-rail.ts src/core/payment-rail.test.ts
git commit -m "feat: add PaymentRail interface and pricing normalisation"
```

---

### Task 2: Extract L402 rail from engine

**Files:**
- Create: `toll-booth/src/core/l402-rail.ts`
- Test: `toll-booth/src/core/l402-rail.test.ts`
- Reference: `toll-booth/src/core/toll-booth.ts` (lines 185-245: `handleL402Auth()`)
- Reference: `toll-booth/src/macaroon.ts` (mintMacaroon, verifyMacaroon)

The L402 rail wraps the existing L402 auth logic (macaroon mint/verify, preimage check, settlement) behind the PaymentRail interface. This task creates the rail — the next task wires it into the engine.

- [ ] **Step 1: Write failing tests for L402Rail**

Create `toll-booth/src/core/l402-rail.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createL402Rail } from './l402-rail.js'
import { mintMacaroon } from '../macaroon.js'
import { createHash, randomBytes } from 'node:crypto'

function makePreimageAndHash() {
  const preimage = randomBytes(32).toString('hex')
  const paymentHash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex')
  return { preimage, paymentHash }
}

const ROOT_KEY = randomBytes(32).toString('hex')

describe('L402Rail', () => {
  describe('detect', () => {
    it('returns true for L402 Authorization header', () => {
      const rail = createL402Rail({
        rootKey: ROOT_KEY,
        storage: mockStorage(),
        defaultAmount: 1000,
      })
      const req = makeRequest({ authorization: 'L402 abc:def' })
      expect(rail.detect(req)).toBe(true)
    })

    it('returns false for missing Authorization header', () => {
      const rail = createL402Rail({
        rootKey: ROOT_KEY,
        storage: mockStorage(),
        defaultAmount: 1000,
      })
      const req = makeRequest({})
      expect(rail.detect(req)).toBe(false)
    })

    it('returns false for Bearer token', () => {
      const rail = createL402Rail({
        rootKey: ROOT_KEY,
        storage: mockStorage(),
        defaultAmount: 1000,
      })
      const req = makeRequest({ authorization: 'Bearer xyz' })
      expect(rail.detect(req)).toBe(false)
    })
  })

  describe('verify', () => {
    it('verifies valid L402 credential', () => {
      const { preimage, paymentHash } = makePreimageAndHash()
      const macaroon = mintMacaroon(ROOT_KEY, paymentHash, 1000)
      const storage = mockStorage()
      storage.isSettled.mockReturnValue(false)
      storage.settleWithCredit.mockReturnValue(true)
      storage.debit.mockReturnValue({ success: true, remaining: 900 })
      storage.balance.mockReturnValue(900)

      const rail = createL402Rail({
        rootKey: ROOT_KEY,
        storage,
        defaultAmount: 1000,
      })

      const req = makeRequest({ authorization: `L402 ${macaroon}:${preimage}` })
      const result = rail.verify(req)

      expect(result.authenticated).toBe(true)
      expect(result.paymentId).toBe(paymentHash)
      expect(result.mode).toBe('credit')
      expect(result.currency).toBe('sat')
    })

    it('rejects invalid preimage', () => {
      const { paymentHash } = makePreimageAndHash()
      const macaroon = mintMacaroon(ROOT_KEY, paymentHash, 1000)
      const storage = mockStorage()
      storage.isSettled.mockReturnValue(false)

      const rail = createL402Rail({
        rootKey: ROOT_KEY,
        storage,
        defaultAmount: 1000,
      })

      const badPreimage = randomBytes(32).toString('hex')
      const req = makeRequest({ authorization: `L402 ${macaroon}:${badPreimage}` })
      const result = rail.verify(req)

      expect(result.authenticated).toBe(false)
    })
  })

  describe('challenge', () => {
    it('generates L402 challenge with invoice and macaroon', async () => {
      const backend = {
        createInvoice: vi.fn().mockResolvedValue({
          bolt11: 'lnbc1000...',
          paymentHash: 'abc123'.padEnd(64, '0'),
        }),
        checkInvoice: vi.fn(),
      }

      const rail = createL402Rail({
        rootKey: ROOT_KEY,
        storage: mockStorage(),
        defaultAmount: 1000,
        backend,
      })

      const result = await rail.challenge('/api/test', { sats: 100 })
      expect(result.headers['WWW-Authenticate']).toMatch(/^L402 /)
      expect(result.body.l402).toBeDefined()
      const l402 = result.body.l402 as Record<string, unknown>
      expect(l402.invoice).toBe('lnbc1000...')
      expect(l402.macaroon).toBeDefined()
      expect(l402.amount_sats).toBe(1000)
    })
  })
})

function mockStorage() {
  return {
    credit: vi.fn(),
    debit: vi.fn().mockReturnValue({ success: true, remaining: 0 }),
    balance: vi.fn().mockReturnValue(0),
    adjustCredits: vi.fn().mockReturnValue(0),
    settle: vi.fn().mockReturnValue(true),
    isSettled: vi.fn().mockReturnValue(false),
    settleWithCredit: vi.fn().mockReturnValue(true),
    getSettlementSecret: vi.fn().mockReturnValue(undefined),
    claimForRedeem: vi.fn().mockReturnValue(true),
    pendingClaims: vi.fn().mockReturnValue([]),
    tryAcquireRecoveryLease: vi.fn().mockReturnValue(undefined),
    extendRecoveryLease: vi.fn().mockReturnValue(true),
    storeInvoice: vi.fn(),
    pendingInvoiceCount: vi.fn().mockReturnValue(0),
    getInvoice: vi.fn().mockReturnValue(undefined),
    getInvoiceForStatus: vi.fn().mockReturnValue(undefined),
    pruneExpiredInvoices: vi.fn().mockReturnValue(0),
    pruneStaleRecords: vi.fn().mockReturnValue(0),
    close: vi.fn(),
  }
}

function makeRequest(headers: Record<string, string>) {
  return {
    method: 'GET',
    path: '/api/test',
    headers,
    ip: '127.0.0.1',
  }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run src/core/l402-rail.test.ts`
Expected: FAIL — `createL402Rail` does not exist

- [ ] **Step 3: Implement L402Rail**

Create `toll-booth/src/core/l402-rail.ts`. This extracts the logic from `toll-booth.ts` lines 185-245 (`handleL402Auth`) and lines 117-163 (challenge generation) into the PaymentRail interface:

```typescript
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto'
import { mintMacaroon, verifyMacaroon } from '../macaroon.js'
import type { StorageBackend } from '../storage/interface.js'
import type { LightningBackend } from '../types.js'
import type { TollBoothRequest } from './types.js'
import type { PaymentRail, PriceInfo, ChallengeFragment, RailVerifyResult } from './payment-rail.js'

export interface L402RailConfig {
  rootKey: string
  storage: StorageBackend
  defaultAmount: number
  backend?: LightningBackend
  redeemCashu?: (token: string, paymentHash: string) => Promise<number>
}

export function createL402Rail(config: L402RailConfig): PaymentRail {
  const { rootKey, storage, defaultAmount, backend } = config

  return {
    type: 'l402',
    creditSupported: true,

    canChallenge(price: PriceInfo): boolean {
      return price.sats !== undefined
    },

    detect(req: TollBoothRequest): boolean {
      const auth = req.headers.authorization ?? req.headers.Authorization ?? ''
      return /^L402\s/i.test(auth)
    },

    async challenge(route: string, price: PriceInfo): Promise<ChallengeFragment> {
      const amount = defaultAmount
      let bolt11 = ''
      let paymentHash: string

      if (backend) {
        const invoice = await backend.createInvoice(amount, `toll-booth: ${route}`)
        bolt11 = invoice.bolt11
        paymentHash = invoice.paymentHash
      } else {
        // Cashu-only mode: synthetic payment hash
        paymentHash = randomBytes(32).toString('hex')
      }

      const macaroon = mintMacaroon(rootKey, paymentHash, amount)

      return {
        headers: {
          'WWW-Authenticate': `L402 macaroon="${macaroon}", invoice="${bolt11}"`,
        },
        body: {
          l402: {
            invoice: bolt11,
            macaroon,
            payment_hash: paymentHash,
            amount_sats: amount,
          },
        },
      }
    },

    // NOTE: verify() only authenticates — it does NOT debit.
    // Balance tracking and debit stay in the engine (per spec).
    verify(req: TollBoothRequest): RailVerifyResult {
      const auth = req.headers.authorization ?? req.headers.Authorization ?? ''
      const token = auth.replace(/^L402\s+/i, '')
      const lastColon = token.lastIndexOf(':')

      if (lastColon === -1) {
        return { authenticated: false, paymentId: '', mode: 'credit', currency: 'sat' }
      }

      const macaroonBase64 = token.slice(0, lastColon)
      const preimage = token.slice(lastColon + 1)

      const context = req.path ? { path: req.path, ip: req.ip } : undefined
      const verification = verifyMacaroon(rootKey, macaroonBase64, context)

      if (!verification.valid) {
        return { authenticated: false, paymentId: '', mode: 'credit', currency: 'sat' }
      }

      const paymentHash = verification.paymentHash!
      const creditBalance = verification.creditBalance!

      // Verify preimage: Lightning (sha256) or Cashu (settlement secret)
      const isLightning = isValidLightningPreimage(preimage, paymentHash)
      const settlementSecret = storage.getSettlementSecret(paymentHash)
      const isCashu = settlementSecret !== undefined &&
        preimage.length === settlementSecret.length &&
        timingSafeEqual(Buffer.from(preimage), Buffer.from(settlementSecret))

      if (!isLightning && !isCashu) {
        if (!storage.isSettled(paymentHash)) {
          return { authenticated: false, paymentId: paymentHash, mode: 'credit', currency: 'sat' }
        }
      }

      // First-time settlement — credits the balance
      if (!storage.isSettled(paymentHash)) {
        const settled = storage.settleWithCredit(paymentHash, creditBalance, preimage)
        if (!settled && !isLightning) {
          return { authenticated: false, paymentId: paymentHash, mode: 'credit', currency: 'sat' }
        }
      }

      // Return current balance — engine will debit and check sufficiency
      const remaining = storage.balance(paymentHash)

      return {
        authenticated: true,
        paymentId: paymentHash,
        mode: 'credit',
        creditBalance: remaining,
        currency: 'sat',
        customCaveats: verification.customCaveats,
      }
    },
  }
}

function isValidLightningPreimage(preimage: string, paymentHash: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(preimage)) return false
  const computed = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest()
  return timingSafeEqual(computed, Buffer.from(paymentHash, 'hex'))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run src/core/l402-rail.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run ALL existing tests to verify nothing is broken**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run`
Expected: All existing tests PASS (new files are additive only)

- [ ] **Step 6: Commit**

```
cd /Users/darren/WebstormProjects/toll-booth
git add src/core/l402-rail.ts src/core/l402-rail.test.ts
git commit -m "feat: extract L402 logic into L402Rail PaymentRail implementation"
```

---

### Task 3: Refactor engine to use PaymentRail

**Files:**
- Modify: `toll-booth/src/core/toll-booth.ts`
- Modify: `toll-booth/src/core/types.ts`
- Reference: `toll-booth/src/core/toll-booth.test.ts` (must still pass)

This is the critical refactor. The engine's `handle()` method stops calling `handleL402Auth()` directly and instead iterates over registered rails.

- [ ] **Step 1: Update TollBoothCoreConfig to accept rails**

In `toll-booth/src/core/types.ts`, add to `TollBoothCoreConfig`:

```typescript
import type { PaymentRail, PriceInfo } from './payment-rail.js'

// Add to TollBoothCoreConfig:
rails?: PaymentRail[]
normalisedPricing?: Record<string, PriceInfo>
```

- [ ] **Step 2: Update TollBoothResult type to allow 401**

In `toll-booth/src/core/types.ts`, update the challenge action type:

```typescript
// Change status: 402 to status: 401 | 402
{ action: 'challenge'; status: 401 | 402; headers: Record<string, string>; body: Record<string, unknown> }
```

- [ ] **Step 3: Refactor engine handle() to iterate rails**

In `toll-booth/src/core/toll-booth.ts`, replace the hardcoded L402 auth block (lines 45-92) with a rail iteration loop. **CRITICAL: Debit stays in the engine, not in the rail.** Rails only authenticate. The engine handles balance management uniformly across all rails.

```typescript
// Replace hardcoded L402 check with:
for (const rail of rails) {
  if (rail.detect(req)) {
    const result = await Promise.resolve(rail.verify(req))
    if (result.authenticated) {
      // Engine handles debit for credit mode
      if (result.mode === 'credit' && result.paymentId && cost > 0) {
        const debit = storage.debit(result.paymentId, cost, result.currency)
        if (!debit.success) {
          return {
            action: 'challenge' as const,
            status: 402,
            headers: {},
            body: { error: 'Insufficient balance' },
          }
        }
      }

      // Track estimated cost with currency for reconciliation
      if (result.paymentId) {
        estimatedCosts.set(result.paymentId, { cost, ts: Date.now(), currency: result.currency })
      }

      // Replay protection for per-request mode
      if (result.mode === 'per-request') {
        if (storage.isSettled(result.paymentId)) {
          return { action: 'challenge' as const, status: 401, headers: {}, body: { error: 'Payment already used' } }
        }
        storage.settle(result.paymentId)
      }

      // Build response headers
      const headers: Record<string, string> = { ...responseHeaders }
      const remaining = result.mode === 'credit'
        ? storage.balance(result.paymentId, result.currency)
        : undefined
      if (remaining !== undefined) {
        headers['X-Credit-Balance'] = String(remaining)
      }
      if (result.customCaveats) {
        for (const [key, value] of Object.entries(result.customCaveats)) {
          if (/^[a-z0-9_]+$/i.test(key)) {
            headers[`X-Toll-Caveat-${key}`] = value
          }
        }
      }

      // Fire events
      onPayment?.({ timestamp: new Date().toISOString(), paymentHash: result.paymentId, amountSats: cost, currency: result.currency, rail: rail.type })
      onRequest?.({ ... })
      return {
        action: 'proxy' as const,
        upstream,
        headers,
        paymentHash: result.paymentId,
        estimatedCost: cost,
        creditBalance: remaining,
      }
    }
    // Rail detected credentials but verification failed -> 401
    return {
      action: 'challenge' as const,
      status: 401,
      headers: {},
      body: { error: 'Invalid credentials' },
    }
  }
}

// No rail detected credentials -> check free tier, then issue 402 challenge
```

- [ ] **Step 4: Refactor challenge generation to use rails**

Replace the hardcoded invoice/macaroon generation (lines 117-163) with:

```typescript
// Merge all rails' challenges
const challengeHeaders: Record<string, string> = { ...responseHeaders }
const challengeBody: Record<string, unknown> = {}

const normalisedPrice = normalisedPricing[req.path] ?? { sats: defaultAmount }

for (const rail of rails) {
  // Skip rail if it can't handle this price — use canChallenge() if available
  if (!rail.canChallenge?.(normalisedPrice)) continue

  const fragment = await rail.challenge(req.path, normalisedPrice)
  Object.assign(challengeHeaders, fragment.headers)
  Object.assign(challengeBody, fragment.body)
}

challengeBody.message = 'Payment required.'

// Store invoice data from L402 rail if present
const l402Data = challengeBody.l402 as Record<string, unknown> | undefined
if (l402Data?.payment_hash) {
  const paymentHash = l402Data.payment_hash as string
  const statusToken = randomBytes(16).toString('hex')
  storage.storeInvoice(
    paymentHash, l402Data.invoice as string, defaultAmount,
    l402Data.macaroon as string, statusToken, req.ip
  )
  l402Data.payment_url = `/invoice-status/${paymentHash}?token=${statusToken}`
  l402Data.status_token = statusToken
}

onChallenge?.({ ... })
return { action: 'challenge' as const, status: 402, headers: challengeHeaders, body: challengeBody }
```

- [ ] **Step 4: Wire L402Rail into createTollBooth**

When `config.rails` is not provided, auto-create an L402Rail from existing config. This is the backward-compatibility bridge:

```typescript
import { createL402Rail } from './l402-rail.js'
import { normalisePricingTable } from './payment-rail.js'

export function createTollBooth(config: TollBoothCoreConfig): TollBoothEngine {
  const rails = config.rails ?? [
    createL402Rail({
      rootKey: config.rootKey,
      storage: config.storage,
      defaultAmount: config.defaultAmount ?? 1000,
      backend: config.backend,
    })
  ]
  const normalisedPricing = normalisePricingTable(config.pricing ?? {})
  // ... rest of engine setup uses rails and normalisedPricing

  // Update reconcile() to be currency-aware:
  function reconcile(paymentHash: string, actualCost: number, currency?: Currency): ReconcileResult {
    const estimated = estimatedCosts.get(paymentHash)
    const effectiveCurrency = currency ?? estimated?.currency ?? 'sat'
    const estimatedCost = estimated?.cost ?? 0
    const delta = estimatedCost - actualCost
    if (delta !== 0) {
      storage.adjustCredits(paymentHash, delta, effectiveCurrency)
    }
    // ... cleanup stale entries (existing logic)
  }
}
```

- [ ] **Step 5: Update adapter code that calls reconcile()**

In `toll-booth/src/adapters/express.ts`, `web-standard.ts`, and `hono.ts`, update reconcile calls to pass currency from the context. The currency comes from the `estimatedCosts` map (tracked when the rail verified the request), so adapters do not need to change — the engine's reconcile reads currency from the map internally. Verify this works by running existing tests.

- [ ] **Step 6: Run ALL existing tests**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run`
Expected: ALL existing tests PASS. This is the critical gate — the refactor must be invisible to existing tests.

- [ ] **Step 7: Update test assertions for nested challenge body**

The challenge body format intentionally changes from flat (`{ invoice, macaroon, ... }`) to nested (`{ l402: { invoice, macaroon, ... } }`). This is required for multi-rail support. Inventory and update all tests that assert on 402 body structure:

- `src/core/toll-booth.test.ts` — update `body.invoice` -> `body.l402.invoice`, `body.macaroon` -> `body.l402.macaroon`, etc.
- `src/adapters/express.test.ts` — update 402 response body assertions
- `src/adapters/web-standard.test.ts` — same
- `src/adapters/hono.test.ts` — same
- `src/e2e/*.integration.test.ts` — update all E2E 402 body checks
- `src/booth.test.ts` — update all 402 body checks

This is a wire-format breaking change for consumers parsing the 402 body.

- [ ] **Step 8: Run ALL tests after body format migration**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run`
Expected: ALL tests PASS

- [ ] **Step 9: Commit**

```
cd /Users/darren/WebstormProjects/toll-booth
git add src/core/toll-booth.ts src/core/types.ts
git commit -m "refactor: engine uses PaymentRail interface instead of hardcoded L402"
```

---

### Task 4: Update Booth facade and exports

**Files:**
- Modify: `toll-booth/src/booth.ts`
- Modify: `toll-booth/src/index.ts`
- Modify: `toll-booth/src/types.ts`

- [ ] **Step 1: Export new types from index.ts**

Add to `toll-booth/src/index.ts`:

```typescript
export type { PaymentRail, PriceInfo, PricingEntry, ChallengeFragment, RailVerifyResult, SettleResult, Currency } from './core/payment-rail.js'
export { normalisePricing, normalisePricingTable } from './core/payment-rail.js'
export { createL402Rail } from './core/l402-rail.js'
export type { L402RailConfig } from './core/l402-rail.js'
```

- [ ] **Step 2: Update PricingTable type in types.ts**

In `toll-booth/src/types.ts`, update `PricingTable` to accept both forms:

```typescript
import type { PricingEntry } from './core/payment-rail.js'

// Replace: export type PricingTable = Record<string, number>
// With:
export type PricingTable = Record<string, PricingEntry>
```

- [ ] **Step 3: Update Booth constructor to normalise pricing**

In `toll-booth/src/booth.ts`, add pricing normalisation in the constructor:

```typescript
import { normalisePricingTable } from './core/payment-rail.js'

// In constructor, after existing validation:
const normalisedPricing = normalisePricingTable(config.pricing)
// Pass normalisedPricing to createTollBooth
```

- [ ] **Step 4: Run ALL tests**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run`
Expected: ALL tests PASS

- [ ] **Step 5: Commit**

```
cd /Users/darren/WebstormProjects/toll-booth
git add src/booth.ts src/index.ts src/types.ts
git commit -m "refactor: update Booth facade and exports for PaymentRail abstraction"
```

---

## Chunk 2: Dual-Currency Storage + Macaroon Currency Caveat (toll-booth)

### Task 5: Add currency caveat to macaroon

**Files:**
- Modify: `toll-booth/src/macaroon.ts`
- Modify: `toll-booth/src/macaroon.test.ts`

- [ ] **Step 1: Write failing test for currency caveat**

Add to `toll-booth/src/macaroon.test.ts`:

```typescript
describe('currency caveat', () => {
  it('mints macaroon with currency caveat', () => {
    const mac = mintMacaroon(ROOT_KEY, HASH, 1000, undefined, 'usd')
    const caveats = parseCaveats(mac)
    expect(caveats.currency).toBe('usd')
  })

  it('defaults to sat when no currency specified', () => {
    const mac = mintMacaroon(ROOT_KEY, HASH, 1000)
    const caveats = parseCaveats(mac)
    expect(caveats.currency).toBe('sat')
  })

  it('verifyMacaroon returns currency in result', () => {
    const mac = mintMacaroon(ROOT_KEY, HASH, 1000, undefined, 'usd')
    const result = verifyMacaroon(ROOT_KEY, mac)
    expect(result.currency).toBe('usd')
  })

  it('currency is a reserved caveat key', () => {
    expect(() => mintMacaroon(ROOT_KEY, HASH, 1000, ['currency = sat'])).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run src/macaroon.test.ts -t "currency caveat"`
Expected: FAIL

- [ ] **Step 3: Implement currency caveat**

In `toll-booth/src/macaroon.ts`:

1. Add `'currency'` to `KNOWN_CAVEATS` set (line 4)
2. Add `'currency'` to `RESERVED_CAVEAT_KEYS` set (line 7)
3. Update `mintMacaroon` signature: add optional `currency: Currency = 'sat'` parameter
   - Add caveat: `currency = ${currency}`
4. Update `verifyMacaroon` to extract `currency` from caveats and include in `VerifyResult`

- [ ] **Step 4: Run all macaroon tests**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run src/macaroon.test.ts`
Expected: ALL tests PASS (existing + new)

- [ ] **Step 5: Run ALL tests**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run`
Expected: ALL tests PASS

- [ ] **Step 6: Commit**

```
cd /Users/darren/WebstormProjects/toll-booth
git add src/macaroon.ts src/macaroon.test.ts
git commit -m "feat: add currency caveat to macaroon (reserved, defaults to sat)"
```

---

### Task 6: Dual-currency storage — interface and memory implementation

**Files:**
- Modify: `toll-booth/src/storage/interface.ts`
- Modify: `toll-booth/src/storage/memory.ts`
- Modify: `toll-booth/src/storage/memory.test.ts`

- [ ] **Step 1: Write failing tests for currency-aware storage**

Add to `toll-booth/src/storage/memory.test.ts`:

```typescript
describe('dual-currency', () => {
  it('tracks sats balance separately from usd balance', () => {
    const store = memoryStorage()
    store.settleWithCredit('hash-a', 1000)              // defaults to sat
    store.settleWithCredit('hash-b', 500, undefined, 'usd')
    expect(store.balance('hash-a')).toBe(1000)           // sat
    expect(store.balance('hash-b', 'usd')).toBe(500)     // usd
  })

  it('debits from correct currency', () => {
    const store = memoryStorage()
    store.settleWithCredit('hash-a', 1000)
    store.debit('hash-a', 100)                           // sat
    expect(store.balance('hash-a')).toBe(900)

    store.settleWithCredit('hash-b', 500, undefined, 'usd')
    store.debit('hash-b', 50, 'usd')
    expect(store.balance('hash-b', 'usd')).toBe(450)
  })

  it('adjustCredits works with currency', () => {
    const store = memoryStorage()
    store.settleWithCredit('hash-a', 1000, undefined, 'usd')
    store.adjustCredits('hash-a', -200, 'usd')
    expect(store.balance('hash-a', 'usd')).toBe(800)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run src/storage/memory.test.ts -t "dual-currency"`
Expected: FAIL

- [ ] **Step 3: Update StorageBackend interface**

In `toll-booth/src/storage/interface.ts`, add optional `currency` parameter to:
- `credit(paymentHash, amount, currency?: Currency): void`
- `debit(paymentHash, amount, currency?: Currency): DebitResult`
- `balance(paymentHash, currency?: Currency): number`
- `adjustCredits(paymentHash, delta, currency?: Currency): number`
- `settleWithCredit(paymentHash, amount, settlementSecret?, currency?: Currency): boolean`

Import `Currency` from `../core/payment-rail.js`.

- [ ] **Step 4: Update memory storage**

In `toll-booth/src/storage/memory.ts`, change the balances map:

```typescript
// Replace: balances: Map<string, number>
// With:
interface DualBalance { sat: number; usd: number }
const balances = new Map<string, DualBalance>()
```

Update `credit()`, `debit()`, `balance()`, `adjustCredits()`, `settleWithCredit()` to use the `currency` parameter (defaulting to `'sat'`).

- [ ] **Step 5: Run all memory storage tests**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run src/storage/memory.test.ts`
Expected: ALL tests PASS

- [ ] **Step 6: Run ALL tests**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run`
Expected: ALL tests PASS

- [ ] **Step 7: Commit**

```
cd /Users/darren/WebstormProjects/toll-booth
git add src/storage/interface.ts src/storage/memory.ts src/storage/memory.test.ts
git commit -m "feat: dual-currency balance tracking in StorageBackend (memory impl)"
```

---

### Task 7: Dual-currency storage — SQLite implementation + migration

**Files:**
- Modify: `toll-booth/src/storage/sqlite.ts`
- Modify: `toll-booth/src/storage/sqlite.test.ts`

- [ ] **Step 1: Write failing tests for SQLite dual-currency**

Add to `toll-booth/src/storage/sqlite.test.ts`:

```typescript
describe('dual-currency', () => {
  it('tracks sats and usd balances independently', () => {
    const store = sqliteStorage({ path: ':memory:' })
    store.settleWithCredit('hash-a', 1000)
    store.settleWithCredit('hash-b', 500, undefined, 'usd')
    expect(store.balance('hash-a')).toBe(1000)
    expect(store.balance('hash-b', 'usd')).toBe(500)
    store.close()
  })

  it('debits from correct currency column', () => {
    const store = sqliteStorage({ path: ':memory:' })
    store.settleWithCredit('hash-a', 1000, undefined, 'usd')
    store.debit('hash-a', 100, 'usd')
    expect(store.balance('hash-a', 'usd')).toBe(900)
    expect(store.balance('hash-a')).toBe(0)  // sats untouched
    store.close()
  })

  it('adjustCredits works with usd', () => {
    const store = sqliteStorage({ path: ':memory:' })
    store.settleWithCredit('hash-a', 1000, undefined, 'usd')
    store.adjustCredits('hash-a', -200, 'usd')
    expect(store.balance('hash-a', 'usd')).toBe(800)
    store.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run src/storage/sqlite.test.ts -t "dual-currency"`
Expected: FAIL

- [ ] **Step 3: Implement SQLite migration and dual-currency**

In `toll-booth/src/storage/sqlite.ts`:

1. Add migration check in constructor — detect if `balance_sats` column exists:
   ```sql
   -- If column doesn't exist, run migration:
   ALTER TABLE credits ADD COLUMN balance_sats INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE credits ADD COLUMN balance_usd INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE credits ADD COLUMN currency TEXT NOT NULL DEFAULT 'sat';
   UPDATE credits SET balance_sats = balance WHERE balance > 0;
   ```

2. Update CREATE TABLE for fresh databases to include both columns from the start.

3. Update prepared statements: `credit()`, `debit()`, `balance()`, `adjustCredits()`, `settleWithCredit()` to use `balance_sats`/`balance_usd` based on currency parameter.

- [ ] **Step 4: Run all SQLite tests**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run src/storage/sqlite.test.ts`
Expected: ALL tests PASS

- [ ] **Step 5: Run ALL tests**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run`
Expected: ALL tests PASS

- [ ] **Step 6: Commit**

```
cd /Users/darren/WebstormProjects/toll-booth
git add src/storage/sqlite.ts src/storage/sqlite.test.ts
git commit -m "feat: dual-currency SQLite storage with auto-migration from v1 schema"
```

---

### Task 8: Update event types and credit tiers

**Files:**
- Modify: `toll-booth/src/types.ts`

- [ ] **Step 1: Add currency and rail fields to event types**

In `toll-booth/src/types.ts`:

```typescript
// PaymentEvent — add optional fields:
currency?: Currency  // 'sat' | 'usd', defaults to 'sat'
rail?: string        // 'l402' | 'x402' | custom

// RequestEvent — add:
currency?: Currency

// CreditTier — add:
amountUsd?: number   // x402 tier (cents)
creditUsd?: number   // (cents)
```

All new fields optional for backward compatibility.

- [ ] **Step 2: Run ALL tests**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run`
Expected: ALL tests PASS (additive type changes only)

- [ ] **Step 3: Commit**

```
cd /Users/darren/WebstormProjects/toll-booth
git add src/types.ts
git commit -m "feat: add currency/rail to event types, USD credit tiers"
```

---

## Chunk 3: x402 Rail Implementation (toll-booth)

### Task 9: X402Facilitator interface and types

**Files:**
- Create: `toll-booth/src/core/x402-types.ts`

- [ ] **Step 1: Define x402 types**

Create `toll-booth/src/core/x402-types.ts`:

```typescript
export interface X402Payment {
  signature: string
  sender: string
  amount: number        // cents
  network: string       // CAIP-2 network ID
  nonce: string
}

export interface X402VerifyResult {
  valid: boolean
  txHash: string
  amount: number        // settled amount (cents)
  sender: string
}

export interface X402Facilitator {
  verify(payload: X402Payment): Promise<X402VerifyResult>
}

export interface X402RailConfig {
  receiverAddress: string
  network: string
  asset?: string
  facilitator: X402Facilitator
  creditMode?: boolean  // default: true
  facilitatorUrl?: string
}

/** Default USDC contract addresses by network */
export const DEFAULT_USDC_ASSETS: Record<string, string> = {
  'base': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'polygon': '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
}
```

- [ ] **Step 2: Commit**

```
cd /Users/darren/WebstormProjects/toll-booth
git add src/core/x402-types.ts
git commit -m "feat: add x402 type definitions (facilitator, payment, config)"
```

---

### Task 10: X402Rail implementation

**Files:**
- Create: `toll-booth/src/core/x402-rail.ts`
- Create: `toll-booth/src/core/x402-rail.test.ts`

- [ ] **Step 1: Write failing tests for X402Rail**

Create `toll-booth/src/core/x402-rail.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createX402Rail } from './x402-rail.js'
import type { X402Facilitator } from './x402-types.js'

function mockFacilitator(overrides?: Partial<{ valid: boolean; txHash: string; amount: number; sender: string }>): X402Facilitator {
  return {
    verify: vi.fn().mockResolvedValue({
      valid: true,
      txHash: '0xabc123',
      amount: 500,
      sender: '0xsender',
      ...overrides,
    }),
  }
}

function makeRequest(headers: Record<string, string | undefined> = {}) {
  return { method: 'POST', path: '/api/test', headers, ip: '127.0.0.1' }
}

describe('X402Rail', () => {
  describe('detect', () => {
    it('returns true when x-payment header present', () => {
      const rail = createX402Rail({
        receiverAddress: '0xreceiver',
        network: 'base',
        facilitator: mockFacilitator(),
      })
      expect(rail.detect(makeRequest({ 'x-payment': '{}' }))).toBe(true)
    })

    it('returns false when no x-payment header', () => {
      const rail = createX402Rail({
        receiverAddress: '0xreceiver',
        network: 'base',
        facilitator: mockFacilitator(),
      })
      expect(rail.detect(makeRequest())).toBe(false)
    })
  })

  describe('challenge', () => {
    it('returns x402 payment requirements', async () => {
      const rail = createX402Rail({
        receiverAddress: '0xreceiver',
        network: 'base',
        facilitator: mockFacilitator(),
        facilitatorUrl: 'https://x402.org/facilitator',
      })
      const fragment = await rail.challenge('/api/test', { usd: 5 })
      expect(fragment.headers['X-Payment-Required']).toBe('x402')
      const x402 = fragment.body.x402 as Record<string, unknown>
      expect(x402.receiver).toBe('0xreceiver')
      expect(x402.network).toBe('base')
      expect(x402.amount_usd).toBe(5)
      expect(x402.asset).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
    })
  })

  describe('verify', () => {
    it('verifies valid x402 payment (credit mode)', async () => {
      const facilitator = mockFacilitator()
      const rail = createX402Rail({
        receiverAddress: '0xreceiver',
        network: 'base',
        facilitator,
        creditMode: true,
      })

      const payload = JSON.stringify({
        signature: 'sig', sender: '0xs', amount: 500, network: 'base', nonce: 'n1',
      })
      const result = await rail.verify(makeRequest({ 'x-payment': payload }))

      expect(result.authenticated).toBe(true)
      expect(result.paymentId).toBe('0xabc123')
      expect(result.mode).toBe('credit')
      expect(result.creditBalance).toBe(500)
      expect(result.currency).toBe('usd')
    })

    it('verifies valid x402 payment (per-request mode)', async () => {
      const rail = createX402Rail({
        receiverAddress: '0xreceiver',
        network: 'base',
        facilitator: mockFacilitator(),
        creditMode: false,
      })

      const payload = JSON.stringify({
        signature: 'sig', sender: '0xs', amount: 500, network: 'base', nonce: 'n1',
      })
      const result = await rail.verify(makeRequest({ 'x-payment': payload }))

      expect(result.mode).toBe('per-request')
      expect(result.creditBalance).toBeUndefined()
    })

    it('rejects invalid payment', async () => {
      const facilitator: X402Facilitator = {
        verify: vi.fn().mockResolvedValue({ valid: false, txHash: '', amount: 0, sender: '' }),
      }
      const rail = createX402Rail({
        receiverAddress: '0xreceiver',
        network: 'base',
        facilitator,
      })

      const payload = JSON.stringify({
        signature: 'bad', sender: '0xs', amount: 500, network: 'base', nonce: 'n1',
      })
      const result = await rail.verify(makeRequest({ 'x-payment': payload }))

      expect(result.authenticated).toBe(false)
    })

    it('rejects malformed x-payment header', async () => {
      const rail = createX402Rail({
        receiverAddress: '0xreceiver',
        network: 'base',
        facilitator: mockFacilitator(),
      })

      const result = await rail.verify(makeRequest({ 'x-payment': 'not-json' }))
      expect(result.authenticated).toBe(false)
    })
  })

  describe('properties', () => {
    it('type is x402', () => {
      const rail = createX402Rail({
        receiverAddress: '0x', network: 'base', facilitator: mockFacilitator(),
      })
      expect(rail.type).toBe('x402')
    })

    it('creditSupported is true', () => {
      const rail = createX402Rail({
        receiverAddress: '0x', network: 'base', facilitator: mockFacilitator(),
      })
      expect(rail.creditSupported).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run src/core/x402-rail.test.ts`
Expected: FAIL — `createX402Rail` does not exist

- [ ] **Step 3: Implement X402Rail**

Create `toll-booth/src/core/x402-rail.ts`:

```typescript
import type { TollBoothRequest } from './types.js'
import type { PaymentRail, PriceInfo, ChallengeFragment, RailVerifyResult } from './payment-rail.js'
import type { X402RailConfig, X402Payment } from './x402-types.js'
import { DEFAULT_USDC_ASSETS } from './x402-types.js'

export function createX402Rail(config: X402RailConfig): PaymentRail {
  const {
    receiverAddress,
    network,
    asset = DEFAULT_USDC_ASSETS[network],
    facilitator,
    creditMode = true,
    facilitatorUrl,
  } = config

  return {
    type: 'x402',
    creditSupported: true,

    canChallenge(price: PriceInfo): boolean {
      return price.usd !== undefined
    },

    detect(req: TollBoothRequest): boolean {
      return req.headers['x-payment'] !== undefined
    },

    async challenge(route: string, price: PriceInfo): Promise<ChallengeFragment> {
      return {
        headers: { 'X-Payment-Required': 'x402' },
        body: {
          x402: {
            receiver: receiverAddress,
            network,
            asset,
            amount_usd: price.usd,
            ...(facilitatorUrl && { facilitator: facilitatorUrl }),
          },
        },
      }
    },

    async verify(req: TollBoothRequest): Promise<RailVerifyResult> {
      const raw = req.headers['x-payment']
      if (!raw) {
        return { authenticated: false, paymentId: '', mode: 'per-request', currency: 'usd' }
      }

      let payload: X402Payment
      try {
        payload = JSON.parse(raw)
      } catch {
        return { authenticated: false, paymentId: '', mode: 'per-request', currency: 'usd' }
      }

      try {
        const result = await facilitator.verify(payload)
        if (!result.valid) {
          return { authenticated: false, paymentId: result.txHash || '', mode: 'per-request', currency: 'usd' }
        }

        return {
          authenticated: true,
          paymentId: result.txHash,
          mode: creditMode ? 'credit' : 'per-request',
          creditBalance: creditMode ? result.amount : undefined,
          currency: 'usd',
        }
      } catch {
        return { authenticated: false, paymentId: '', mode: 'per-request', currency: 'usd' }
      }
    },

    async settle() {
      return { settled: true }
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run src/core/x402-rail.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run ALL tests**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```
cd /Users/darren/WebstormProjects/toll-booth
git add src/core/x402-rail.ts src/core/x402-rail.test.ts
git commit -m "feat: add X402Rail — x402 stablecoin payment rail implementation"
```

---

### Task 11: Wire x402 into Booth facade + replay protection

**Files:**
- Modify: `toll-booth/src/booth.ts`
- Modify: `toll-booth/src/types.ts`
- Modify: `toll-booth/src/index.ts`
- Modify: `toll-booth/src/core/toll-booth.ts`
- Create: `toll-booth/src/e2e/x402-flow.integration.test.ts`

- [ ] **Step 1: Add x402 config to BoothConfig**

In `toll-booth/src/types.ts`, add to `BoothConfig`:

```typescript
import type { X402RailConfig } from './core/x402-types.js'

// Add to BoothConfig:
x402?: X402RailConfig
```

- [ ] **Step 2: Update Booth constructor to create X402Rail**

In `toll-booth/src/booth.ts`:

```typescript
import { createX402Rail } from './core/x402-rail.js'
import type { PaymentRail } from './core/payment-rail.js'

// In constructor, build rails array:
const rails: PaymentRail[] = []

if (config.backend || config.redeemCashu) {
  rails.push(createL402Rail({ rootKey, storage, defaultAmount, backend: config.backend }))
}

if (config.x402) {
  rails.push(createX402Rail(config.x402))
}

if (rails.length === 0) {
  throw new Error('At least one payment method required (backend, redeemCashu, or x402)')
}
```

- [ ] **Step 3: Add replay protection in engine**

In `toll-booth/src/core/toll-booth.ts`, after rail verify returns authenticated for per-request mode:

```typescript
if (result.mode === 'per-request') {
  if (storage.isSettled(result.paymentId)) {
    return {
      action: 'challenge' as const,
      status: 401,
      headers: {},
      body: { error: 'Payment already used' },
    }
  }
  storage.settle(result.paymentId)
}
```

- [ ] **Step 4: Export x402 types from index.ts**

Add to `toll-booth/src/index.ts`:

```typescript
export { createX402Rail } from './core/x402-rail.js'
export type { X402RailConfig, X402Facilitator, X402Payment, X402VerifyResult } from './core/x402-types.js'
export { DEFAULT_USDC_ASSETS } from './core/x402-types.js'
```

- [ ] **Step 5: Write integration test for x402 flow**

Create `toll-booth/src/e2e/x402-flow.integration.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { Booth } from '../booth.js'
import type { X402Facilitator } from '../core/x402-types.js'

function mockFacilitator(): X402Facilitator {
  return {
    verify: vi.fn().mockResolvedValue({
      valid: true,
      txHash: '0x' + 'a'.repeat(62),
      amount: 500,
      sender: '0xsender',
    }),
  }
}

describe('x402 integration flow', () => {
  it('returns 402 with x402 payment requirements', async () => {
    // Create booth with x402 only (no Lightning backend)
    // Hit endpoint without credentials
    // Verify 402 response includes x402 body
  })

  it('returns dual-rail 402 when both configured', async () => {
    // Create booth with Lightning backend AND x402
    // Hit endpoint without credentials
    // Verify 402 includes both l402 and x402 in body
  })

  it('rejects replayed x402 payment in per-request mode', async () => {
    // Configure x402 with creditMode: false
    // Send valid payment -> success
    // Replay same payment -> rejected
  })

  it('x402 credit mode: payment -> macaroon -> L402 session (critical path)', async () => {
    // This tests the spec's "key architectural insight":
    // 1. Request with no credentials -> 402 with x402 option
    // 2. Request with x-payment header -> engine settles via facilitator,
    //    mints macaroon with currency=usd caveat, returns macaroon in response
    // 3. Subsequent request with L402 macaroon -> debits from USD balance
    // Verify: macaroon contains currency=usd caveat
    // Verify: balance is tracked in USD cents
    // Verify: subsequent L402 requests debit from USD balance
  })
})
```

- [ ] **Step 6: Run ALL tests**

Run: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```
cd /Users/darren/WebstormProjects/toll-booth
git add src/booth.ts src/types.ts src/index.ts src/core/toll-booth.ts src/e2e/x402-flow.integration.test.ts
git commit -m "feat: wire x402 into Booth facade with replay protection"
```

---

## Chunk 4: token-toll Integration

### Task 12: Add x402 config surface to token-toll

**Files:**
- Modify: `token-toll/src/config.ts`
- Modify: `token-toll/src/config.test.ts`

- [ ] **Step 1: Write failing tests for x402 config**

Add to `token-toll/src/config.test.ts`:

```typescript
describe('x402 config', () => {
  it('parses x402 config from env vars', () => {
    const config = loadConfig([], {
      UPSTREAM_URL: 'http://localhost:11434',
      X402_RECEIVER: '0xabc123',
      X402_NETWORK: 'base',
      X402_FACILITATOR_URL: 'https://x402.org/facilitator',
      X402_FACILITATOR_KEY: 'test-key',
    })
    expect(config.x402).toEqual({
      receiverAddress: '0xabc123',
      network: 'base',
      facilitatorUrl: 'https://x402.org/facilitator',
      facilitatorKey: 'test-key',
    })
  })

  it('parses dual-currency pricing', () => {
    const config = loadConfig([], {
      UPSTREAM_URL: 'http://localhost:11434',
      DEFAULT_PRICE_SATS: '100',
      DEFAULT_PRICE_USD: '5',
    })
    expect(config.defaultPriceSats).toBe(100)
    expect(config.defaultPriceUsd).toBe(5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run src/config.test.ts -t "x402 config"`
Expected: FAIL

- [ ] **Step 3: Implement x402 config parsing**

In `token-toll/src/config.ts`, add to `TokenTollConfig`:

```typescript
x402?: {
  receiverAddress: string
  network: string
  facilitatorUrl?: string
  facilitatorKey?: string
  asset?: string
  creditMode?: boolean
}
defaultPriceSats?: number
defaultPriceUsd?: number
```

Parse from env vars (`X402_RECEIVER`, `X402_NETWORK`, `X402_FACILITATOR_URL`, `X402_FACILITATOR_KEY`, `DEFAULT_PRICE_USD`) and YAML config file.

- [ ] **Step 4: Run tests**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run src/config.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
cd /Users/darren/WebstormProjects/token-toll
git add src/config.ts src/config.test.ts
git commit -m "feat: add x402 configuration surface (env vars, YAML)"
```

---

### Task 13: Wire x402 into token-toll server

**Files:**
- Modify: `token-toll/src/server.ts`
- Modify: `token-toll/src/proxy/pricing.ts`
- Modify: `token-toll/src/proxy/pricing.test.ts`
- Modify: `token-toll/src/proxy/handler.ts`

- [ ] **Step 1: Update pricing module for dual-currency**

In `token-toll/src/proxy/pricing.ts`, update `resolveModelPrice` to return `PriceInfo`:

```typescript
import type { PriceInfo } from '@thecryptodonkey/toll-booth'

export function resolveModelPrice(model: string, config: TokenTollConfig): PriceInfo {
  const sats = /* existing sats resolution logic */
  const usd = config.defaultPriceUsd
  return { sats, ...(usd !== undefined && { usd }) }
}
```

- [ ] **Step 2: Write tests for dual-currency pricing**

Add to `token-toll/src/proxy/pricing.test.ts`:

```typescript
it('returns PriceInfo with both currencies when configured', () => {
  const result = resolveModelPrice('llama3', {
    defaultPriceSats: 100,
    defaultPriceUsd: 5,
    // ... other config
  })
  expect(result).toEqual({ sats: 100, usd: 5 })
})

it('returns sats-only when no USD configured', () => {
  const result = resolveModelPrice('llama3', {
    defaultPriceSats: 100,
    // ... other config
  })
  expect(result).toEqual({ sats: 100 })
})
```

- [ ] **Step 3: Update server.ts to pass x402 config to toll-booth**

In `token-toll/src/server.ts`, when creating the Booth:

```typescript
// If x402 config present, include in Booth config
const boothConfig = {
  // ... existing config
  ...(config.x402 && {
    x402: {
      receiverAddress: config.x402.receiverAddress,
      network: config.x402.network,
      asset: config.x402.asset,
      facilitator: createFacilitator(config.x402),
      creditMode: config.x402.creditMode ?? true,
      facilitatorUrl: config.x402.facilitatorUrl,
    },
  }),
}
```

- [ ] **Step 4: Run ALL token-toll tests**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
cd /Users/darren/WebstormProjects/token-toll
git add src/server.ts src/proxy/pricing.ts src/proxy/pricing.test.ts src/proxy/handler.ts
git commit -m "feat: wire x402 into token-toll server with dual-currency pricing"
```

---

### Task 14: Update discovery endpoints for x402

**Files:**
- Modify: `token-toll/src/discovery/well-known.ts`
- Modify: `token-toll/src/discovery/well-known.test.ts`
- Modify: `token-toll/src/discovery/llms-txt.ts`
- Modify: `token-toll/src/discovery/llms-txt.test.ts`
- Modify: `token-toll/src/discovery/openapi.ts`
- Modify: `token-toll/src/discovery/openapi.test.ts`

- [ ] **Step 1: Update well-known endpoint**

In `token-toll/src/discovery/well-known.ts`, add x402 payment method to descriptor when configured:

```typescript
if (config.x402) {
  descriptor.payment_methods.push({
    type: 'x402',
    network: config.x402.network,
    asset: config.x402.asset || DEFAULT_USDC_ASSETS[config.x402.network],
    receiver: config.x402.receiverAddress,
    ...(config.x402.facilitatorUrl && { facilitator: config.x402.facilitatorUrl }),
  })
}
```

- [ ] **Step 2: Update llms.txt**

In `token-toll/src/discovery/llms-txt.ts`, add x402 payment method description when configured.

- [ ] **Step 3: Update OpenAPI spec**

In `token-toll/src/discovery/openapi.ts`, document x402 in the 402 response schema.

- [ ] **Step 4: Update tests**

Update discovery tests to verify x402 info appears when configured and is absent when not.

- [ ] **Step 5: Run ALL tests**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```
cd /Users/darren/WebstormProjects/token-toll
git add src/discovery/
git commit -m "feat: update discovery endpoints for x402 payment method"
```

---

### Task 15: E2E tests for x402 in token-toll

**Files:**
- Modify: `token-toll/test/e2e/inference.test.ts`

- [ ] **Step 1: Add x402 E2E test scenarios**

Add to `token-toll/test/e2e/inference.test.ts`:

```typescript
describe('x402 payments', () => {
  it('includes x402 in 402 challenge when configured', async () => {
    // Start server with x402 config + mock facilitator
    // Hit /v1/chat/completions without credentials
    // Verify 402 body includes x402 payment requirements
  })

  it('accepts x402 payment and returns inference result', async () => {
    // Configure x402 with mock facilitator
    // Send request with x-payment header
    // Verify inference result returned
  })

  it('returns dual-rail 402 when both L402 and x402 configured', async () => {
    // Configure both payment methods
    // Verify 402 includes both l402 and x402 options
  })

  it('discovery endpoints include x402 info', async () => {
    // Verify /.well-known/l402, /llms.txt, /openapi.json all mention x402
  })
})
```

- [ ] **Step 2: Run E2E tests**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run test/e2e/`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```
cd /Users/darren/WebstormProjects/token-toll
git add test/e2e/inference.test.ts
git commit -m "test: add E2E tests for x402 stablecoin payments"
```

---

## Final Verification

- [ ] **Run full toll-booth test suite**: `cd /Users/darren/WebstormProjects/toll-booth && npx vitest run`
- [ ] **Run full token-toll test suite**: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run`
- [ ] **Verify backward compatibility**: existing toll-booth consumers (token-toll with L402-only config) work identically
- [ ] **Review all changes** using superpowers:requesting-code-review
