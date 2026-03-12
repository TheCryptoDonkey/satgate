# x402 Stablecoin Payments Design

**Date:** 2026-03-12
**Status:** Approved
**Scope:** toll-booth (payment rail abstraction + x402 rail) + token-toll (config surface)

## Motivation

Three drivers converging:

1. **Market positioning** — toll-booth should be the universal 402 middleware regardless of payment rail. x402 is gaining traction (backed by Coinbase/Cloudflare/Stripe, as of early 2025).
2. **Dollar-denominated pricing** — satoshi pricing is volatile and confusing for non-Bitcoin users. USDC enables stable dollar pricing for AI inference.
3. **Agent commerce readiness** — AI agents need to pay for things. x402 is becoming the default protocol for agent-to-service payments. toll-booth must be in that ecosystem.

## Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Where x402 lives | toll-booth first, staged | All consumers inherit x402. Clean dependency graph. |
| 2 | Multi-rail challenge | Both L402 + x402 in 402 response | Client picks. Most powerful. Matches content negotiation pattern. |
| 3 | Facilitator model | Pluggable callback | Consistent with toll-booth's DNA (like `redeemCashu`). No hard-coupling to Coinbase. |
| 4 | Pricing | Explicit dual (sats + USD) | No auto-conversion. Avoids exchange rate complexity entirely. |
| 5 | Credit model | Both per-request and credit-compatible, operator chooses | Per-request for simple APIs. Credit for high-frequency (AI inference). |
| 6 | Internal abstraction | PaymentRail interface (full lifecycle) | Challenge, verify, settle per rail. Engine becomes rail-agnostic orchestrator. |

## Architecture

### Payment Rail Abstraction

The core refactor introduces a `PaymentRail` interface that encapsulates the full payment lifecycle. The engine becomes a rail-agnostic orchestrator.

```
Client Request
      |
      v
  +------------------+
  |  Engine: detect   |---- tries each rail's detect()
  +--------+---------+
           |
     +-----+------+
     | matched?    |
     +--- no ------+---> Engine calls all rails' challenge()
     |             |     merges into single 402 response
     +--- yes -----+
           |
      +----v-----+
      |  verify   |---- matched rail verifies credentials
      +----+-----+
           |
     +-----+------+
     |  mode?      |
     +- credit ----+---> engine issues macaroon, tracks balance
     +- per-req ---+---> serve immediately, no balance
     +-------------+
```

### Key Types

```typescript
interface PaymentRail {
  type: string                    // 'l402', 'x402', or custom
  creditSupported: boolean        // can this rail fund a balance?

  challenge(route: string, price: PriceInfo): Promise<ChallengeFragment>
  detect(req: Request): boolean
  verify(req: Request): Promise<RailVerifyResult>
  settle?(paymentId: string, amount: number): Promise<SettleResult>
}

interface SettleResult {
  settled: boolean
  txHash?: string                  // on-chain transaction hash (x402)
}

interface ChallengeFragment {
  headers: Record<string, string>  // rail-specific headers
  body: Record<string, unknown>    // merged into 402 JSON body
}

// Named RailVerifyResult to avoid collision with macaroon.ts VerifyResult
interface RailVerifyResult {
  authenticated: boolean
  paymentId: string
  mode: 'per-request' | 'credit'
  creditBalance?: number           // sats or cents, engine tracks
  currency: 'sat' | 'usd'         // so engine knows the unit
}

// Accepts both number (backward-compat, treated as sats) and PriceInfo
type PricingEntry = number | PriceInfo

// All amounts in smallest currency unit: satoshis for sats, cents for USD.
// Config example: { sats: 100 } = 100 satoshis; { usd: 5 } = 5 cents ($0.05)
interface PriceInfo {
  sats?: number                    // L402 price (satoshis)
  usd?: number                     // x402 price (cents)
}

// PricingTable accepts both forms for backward compatibility
// Runtime normalisation: number -> { sats: n }
type PricingTable = Record<string, PricingEntry>

// x402 payment payload from client's X-PAYMENT header
interface X402Payment {
  signature: string                // ERC-3009 signed authorisation
  sender: string                   // payer wallet address
  amount: number                   // cents
  network: string                  // CAIP-2 network identifier
  nonce: string                    // replay protection
}

interface X402VerifyResult {
  valid: boolean
  txHash: string                   // on-chain transaction hash
  amount: number                   // settled amount (cents)
  sender: string                   // payer wallet address
}

interface X402Facilitator {
  verify(payload: X402Payment): Promise<X402VerifyResult>
}
```

### Engine Changes

- `handle()` iterates rails instead of hardcoding L402 auth
- Challenge merging: combines all enabled rails' `ChallengeFragment` into one 402 response
- Balance tracking becomes currency-aware (sats vs cents stored separately)
- Reconciliation signature changes: `reconcile(paymentHash, actualCost, currency: 'sat' | 'usd')` — the currency is also stored in the internal `estimatedCosts` map so the engine knows which balance column to adjust
- detect/verify separation preserves 402 (no credentials) vs 401 (bad credentials) semantics
- `Booth` constructor validation updated: accepts `backend`, `redeemCashu`, OR `x402` as a valid payment method (at least one required)

## L402 Rail Implementation

Refactor, not rewrite. Existing L402 logic moves into a `PaymentRail` implementation.

**What moves out of the engine into the rail:**
- `handleL402Auth()` -> `l402Rail.verify()`
- Macaroon minting for challenges -> `l402Rail.challenge()`
- L402 header parsing -> `l402Rail.detect()`

**What stays in the engine:**
- Balance tracking and debit
- Reconciliation
- Free tier logic
- Capacity management

The existing `LightningBackend` interface, Cashu callback, and NWC callback all stay as they are — they are L402 rail internals. No breaking changes to toll-booth's public API at this layer.

## x402 Rail Implementation

```typescript
function createX402Rail(config: X402RailConfig): PaymentRail {
  return {
    type: 'x402',
    creditSupported: true,

    async challenge(route, price) {
      return {
        headers: { 'X-Payment-Required': 'x402' },
        body: {
          x402: {
            receiver: config.receiverAddress,
            network: config.network,
            asset: config.asset,
            amount_usd: price.usd,
            facilitator: config.facilitatorUrl,
          }
        }
      }
    },

    detect(req) {
      return req.headers.has('x-payment')
    },

    async verify(req) {
      const payload = JSON.parse(req.headers.get('x-payment')!)
      const result = await config.facilitator.verify(payload)
      return {
        authenticated: result.valid,
        paymentId: result.txHash,
        mode: config.creditMode ? 'credit' : 'per-request',
        creditBalance: config.creditMode ? result.amount : undefined,
        currency: 'usd' as const,
      }
    },

    async settle(paymentId, amount) {
      // per-request: facilitator already settled during verify
      // credit: no-op, engine handles balance debit
      return { settled: true }
    }
  }
}
```

### X402 Rail Config

```typescript
interface X402RailConfig {
  receiverAddress: string          // operator's wallet address
  network: string                  // 'base', 'base-sepolia', 'polygon', 'solana'
  asset?: string                   // USDC contract address (default provided per network)
  facilitator: X402Facilitator     // pluggable verification + settlement
  creditMode?: boolean             // per-request or credit (default: true)
}
```

### Facilitator Interface

Pluggable — operator brings their own verification strategy:

```typescript
interface X402Facilitator {
  verify(payload: X402Payment): Promise<X402VerifyResult>
}

// Shipped default: Coinbase CDP facilitator
function coinbaseFacilitator(apiKey: string): X402Facilitator

// Operator can provide: Cloudflare, self-hosted, or custom
```

## Multi-Rail 402 Challenge Response

When a client hits a protected endpoint with no credentials, the engine merges all rails' challenges:

```json
{
  "status": 402,
  "headers": {
    "WWW-Authenticate": "L402 macaroon=..., invoice=...",
    "X-Payment-Required": "x402"
  },
  "body": {
    "l402": {
      "invoice": "lnbc...",
      "macaroon": "...",
      "amount_sats": 100
    },
    "x402": {
      "receiver": "0x...",
      "network": "base",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount_usd": 5,
      "facilitator": "https://x402.org/facilitator"
    },
    "message": "Payment required. Choose a payment method."
  }
}
```

The client picks whichever rail it supports and retries with that rail's credentials. The engine detects which rail and routes accordingly.

## Dual-Currency Balance Tracking

The storage layer tracks balances in both currencies:

```sql
-- credits table (existing, extended)
payment_hash  TEXT PRIMARY KEY
balance_sats  INTEGER          -- L402 balance (renamed from balance)
balance_usd   INTEGER          -- x402 balance (cents)
currency      TEXT             -- 'sat' | 'usd' (which balance is active)
created_at    TEXT
updated_at    TEXT
```

**No cross-currency mixing.** An L402 payment creates a sats balance. An x402 payment creates a USD balance. Each request debits from the currency that funded it. The engine knows which currency to debit because the macaroon encodes the currency (new caveat).

This avoids the exchange rate problem entirely — consistent with the explicit dual pricing decision.

## x402 Credit Mode Flow

The key architectural insight: after x402 payment settles, toll-booth issues a macaroon with a credit balance — reusing L402's proven session infrastructure. The payment rail differs, but session management converges.

```
1. Client hits /v1/chat/completions (no credentials)
2. Engine: no rail detects credentials -> 402 with L402 + x402 options
3. Client chooses x402, signs EVM payment payload
4. Client retries with X-PAYMENT header
5. x402 rail: detect() matches, verify() calls facilitator
6. Facilitator settles on-chain, returns success
7. Engine: credit mode -> issues macaroon with USD balance
8. Response includes macaroon in header
9. Subsequent requests: client uses L402 macaroon
10. L402 rail: detect() matches, verify() checks macaroon
11. Engine: debits USD balance per request
```

After step 8, the x402 rail is no longer involved. The client operates in L402 session mode, debiting from a USD-denominated balance.

## Security: Replay Protection and Finality

### Replay Protection

The engine must track seen `paymentId` values (transaction hashes) from `RailVerifyResult` and reject duplicates. This prevents a client from replaying the same `x-payment` header across multiple requests.

For **credit mode**, replay is naturally prevented: the first verify settles and issues a macaroon. Subsequent requests use the macaroon (L402 path), not the x-payment header. If the same x-payment header is replayed, the engine checks `settlements` table and rejects (same as L402's idempotent settlement).

For **per-request mode**, the engine must maintain a seen-txhash set (in the `settlements` table) and reject any `paymentId` that has already been used. This is a simple INSERT-or-reject on the existing settlements table.

### Finality Guarantees

The `X402Facilitator.verify()` contract: the facilitator MUST NOT return success until the payment has reached sufficient on-chain finality. What "sufficient" means is facilitator-specific:

- Coinbase CDP: 1-second finality on Base (single block confirmation)
- Self-hosted: operator configures confirmation depth

The spec does NOT require toll-booth to independently verify on-chain state. The facilitator is the trusted oracle for settlement. This is analogous to how toll-booth trusts the Lightning backend's `checkInvoice()` — the backend is the source of truth.

**Revert risk for per-request mode:** If a chain reorg reverts the payment after the resource is served, the operator bears the loss. This is acceptable because:
1. Base has 1-second finality with negligible reorg risk
2. The facilitator can require higher confirmation depth for large amounts
3. Credit mode mitigates this entirely (balance acts as a buffer)

Operators concerned about revert risk should use credit mode.

## Macaroon Currency Caveat

New reserved caveat: `currency = sat | usd`

- Added to `KNOWN_CAVEATS` and `RESERVED_CAVEAT_KEYS` in `macaroon.ts`
- `mintMacaroon()` accepts optional `currency` parameter (defaults to `'sat'` for backward compat)
- `verifyMacaroon()` extracts `currency` from caveats and includes it in the existing macaroon `VerifyResult`
- Engine uses the caveat to determine which balance column to debit

Format in macaroon: `currency = usd` (same pattern as existing `credit_balance = 1000`)

## StorageBackend Interface Changes

The `StorageBackend` interface gains currency-aware methods. Existing method signatures are preserved with a `currency` parameter defaulting to `'sat'`:

```typescript
interface StorageBackend {
  // Existing methods — add optional currency param (defaults to 'sat')
  credit(paymentHash: string, amount: number, currency?: 'sat' | 'usd'): Promise<void>
  debit(paymentHash: string, amount: number, currency?: 'sat' | 'usd'): Promise<number>
  balance(paymentHash: string, currency?: 'sat' | 'usd'): Promise<number>
  adjustCredits(paymentHash: string, delta: number, currency?: 'sat' | 'usd'): Promise<void>

  // Existing methods — unchanged
  settle(paymentHash: string, secret: string): Promise<boolean>
  isSettled(paymentHash: string): Promise<boolean>
  // ... rest unchanged
}
```

This is a **soft breaking change** for custom `StorageBackend` implementations — the new parameter is optional with a default, so existing implementations continue to work for L402-only use cases. Custom implementations that want x402 support must handle the `currency` parameter.

## Storage Migration

SQLite migration from existing schema:

```sql
-- Step 1: Add new columns (works on all SQLite versions)
ALTER TABLE credits ADD COLUMN balance_sats INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credits ADD COLUMN balance_usd INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credits ADD COLUMN currency TEXT NOT NULL DEFAULT 'sat';

-- Step 2: Copy existing balance to balance_sats
UPDATE credits SET balance_sats = balance;

-- Step 3: balance column is kept but deprecated (not removed, avoids ALTER TABLE DROP)
-- New code reads/writes balance_sats and balance_usd only
```

No `RENAME COLUMN` needed (avoids SQLite 3.25+ requirement). The old `balance` column is left in place but ignored by new code. A future major version can drop it.

The in-memory storage implementation simply adds the `currency` parameter to its Map-based tracking.

## Event Callback Changes

Event types gain a `currency` field:

```typescript
interface PaymentEvent {
  paymentHash: string
  amount: number
  currency: 'sat' | 'usd'    // NEW
  rail: string                // NEW — 'l402' | 'x402' | custom
  // ... existing fields
}

interface RequestEvent {
  paymentHash?: string
  cost: number
  currency: 'sat' | 'usd'    // NEW
  // ... existing fields
}
```

Existing consumers that destructure these events will see the new fields but are not broken by them.

## Credit Tiers

`CreditTier` gains USD equivalents:

```typescript
interface CreditTier {
  amountSats?: number         // L402 tier
  creditSats?: number
  amountUsd?: number          // x402 tier (cents)
  creditUsd?: number          // (cents)
  label?: string
}
```

Operators can define tiers in either or both currencies. If only sats tiers are defined, only L402 challenges include tier options. Same for USD-only.

## Backward Compatibility

**Non-breaking for existing toll-booth users.**

- `new Booth({ backend: phoenixd(...), ... })` works exactly as today
- Internally wraps the lightning backend in an L402Rail
- x402 is opt-in: `new Booth({ backend: phoenixd(...), x402: { receiver: '0x...', facilitator: coinbase('key') }, ... })`
- No x402 config -> no x402 in the challenge -> pure L402 behaviour
- **Pricing table**: accepts both `Record<string, number>` (existing, treated as sats) and `Record<string, PriceInfo>` (new). Runtime normalisation: `{ '/api': 50 }` becomes `{ '/api': { sats: 50 } }`. No existing code needs changing.
- **StorageBackend**: new `currency` parameter is optional with `'sat'` default. Existing custom implementations work unchanged for L402.
- **Booth constructor**: now accepts `x402` config as a valid payment method alongside `backend` and `redeemCashu`. At least one still required.
- **reconcile()**: gains optional `currency` parameter (defaults to `'sat'`). Existing callers unaffected.

**For token-toll:** add x402 fields to `token-toll.yaml`, everything else inherits from toll-booth.

## Pricing Config

Operators declare prices in both currencies explicitly:

```yaml
# token-toll.yaml
# All amounts in smallest unit: satoshis for sats, cents for USD
pricing:
  /v1/chat/completions:
    sats: 100        # 100 satoshis per 1k tokens
    usd: 5           # 5 cents ($0.05) per 1k tokens
  /v1/embeddings:
    sats: 10         # 10 satoshis per 1k tokens
    usd: 1           # 1 cent ($0.01) per 1k tokens

# toll-booth (library usage)
new Booth({
  pricing: {
    '/api/resource': { sats: 50, usd: 2 },    // 50 sats or 2 cents
  },
  x402: {
    receiver: '0x...',
    network: 'base',
    facilitator: coinbaseFacilitator(process.env.CDP_API_KEY),
  },
})
```

No auto-conversion between currencies. Operator sets both prices. If only one currency is set, only that rail is offered for that route. The engine skips a rail's `challenge()` when the route's `PriceInfo` has no price for that rail's currency (e.g., `price.usd` is undefined → skip x402 rail). The rail is never called with an undefined price.

## Implementation Staging

### Stage 1: PaymentRail abstraction (toll-booth)
- Define `PaymentRail` interface and supporting types
- Refactor engine to use rails instead of hardcoded L402
- Extract existing L402 logic into `L402Rail`
- All existing tests pass unchanged
- **No new features, pure refactor**

### Stage 2: Multi-rail challenge + dual-currency storage (toll-booth)
- Engine merges multiple rails' challenges into single 402
- Storage supports `balance_sats` + `balance_usd` + `currency`
- Macaroon gains `currency` caveat
- Migration path for existing SQLite databases

### Stage 3: x402 rail (toll-booth)
- `X402Rail` implementation
- `X402Facilitator` interface + Coinbase CDP default
- Credit mode (x402 payment -> macaroon -> L402 session)
- Per-request mode
- Tests for x402 challenge, verify, settle, credit flow

### Stage 4: token-toll integration
- Config surface for x402 (YAML, CLI args, env vars)
- Discovery endpoints updated (well-known, llms.txt, openapi.json)
- USD pricing in proxy handler
- E2E tests with x402 payments
