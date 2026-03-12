# token-toll Quick-Start Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npx token-toll` work end-to-end — auto-detect Ollama, connect any Lightning backend, support open/lightning/allowlist auth modes, auto-spawn Cloudflare Tunnel, and be publishable to npm.

**Architecture:** Token-toll gains a new auth middleware layer (`src/auth/`) that sits above toll-booth and routes requests through open, allowlist, or lightning auth. Lightning backend wiring passes toll-booth backend factories through config. A tunnel manager spawns `cloudflared` as a child process. The CLI and config system are extended with new flags.

**Tech Stack:** Hono, @thecryptodonkey/toll-booth (backends: phoenixd, lnbits, lnd, cln), js-yaml, @noble/curves (for NIP-98 schnorr verification), @scure/base (bech32 decode for npub), cloudflared (external binary)

**Spec:** `docs/superpowers/specs/2026-03-12-token-toll-quickstart-design.md`

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `src/auth/middleware.ts` | Auth mode router — open/lightning/allowlist dispatch |
| `src/auth/allowlist.ts` | Allowlist identity extraction (Bearer + NIP-98) |
| `src/auth/allowlist.test.ts` | Allowlist identity tests |
| `src/auth/middleware.test.ts` | Auth middleware routing tests |
| `src/tunnel.ts` | Cloudflare Tunnel child process management |
| `src/tunnel.test.ts` | Tunnel manager tests |
| `src/lightning.ts` | Lightning backend factory (maps CLI flags to toll-booth backends) |
| `src/lightning.test.ts` | Backend factory tests |

### Modified files
| File | Changes |
|------|---------|
| `src/config.ts` | Add new fields to `TokenTollConfig`, `CliArgs`, `FileConfig`; add auth mode inference; add `flatPricing` flag; normalise allowlist entries |
| `src/config.test.ts` | Tests for new config fields, auth inference, pricing mode |
| `src/cli.ts` | New CLI flags, Ollama auto-detect, YAML parsing with js-yaml, tunnel lifecycle, updated banner |
| `src/server.ts` | Accept `backend` in config, thread to `createTollBooth()` and `createPaymentApp()`; swap auth middleware based on auth mode; conditional reconciliation for flat pricing |
| `src/server.test.ts` | Tests for auth modes, flat pricing, backend threading |
| `src/proxy/handler.ts` | Add `flatPricing` option to skip reconciliation |
| `src/proxy/handler.test.ts` | Test flat pricing skip (streaming + non-streaming) |
| `src/index.ts` | Export new auth types |
| `package.json` | Add `files`, `prepublishOnly`, `js-yaml`, `@noble/curves`, `@scure/base` deps |
| `test/e2e/inference.test.ts` | Fix existing tests for new config shape, add open/allowlist/flat-pricing e2e tests |

---

## Chunk 1: Config & Lightning Backend Wiring

### Task 1: Extend config with new fields

**Files:**
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`

- [ ] **Step 1: Write failing tests for new config fields**

Add to `src/config.test.ts`:

```typescript
it('accepts lightning config from CLI args', () => {
  const config = loadConfig({
    upstream: 'http://localhost:11434',
    lightning: 'phoenixd',
    lightningKey: 'mypassword',
  })
  expect(config.lightning).toBe('phoenixd')
  expect(config.lightningUrl).toBe('http://localhost:9740')
  expect(config.lightningKey).toBe('mypassword')
})

it('defaults lightning URL per backend', () => {
  const phoenixd = loadConfig({ upstream: 'http://x', lightning: 'phoenixd', lightningKey: 'pw' })
  expect(phoenixd.lightningUrl).toBe('http://localhost:9740')

  const lnbits = loadConfig({ upstream: 'http://x', lightning: 'lnbits', lightningKey: 'k' })
  expect(lnbits.lightningUrl).toBe('https://legend.lnbits.com')

  const lnd = loadConfig({ upstream: 'http://x', lightning: 'lnd', lightningKey: 'mac' })
  expect(lnd.lightningUrl).toBe('https://localhost:8080')

  const cln = loadConfig({ upstream: 'http://x', lightning: 'cln', lightningKey: 'rune' })
  expect(cln.lightningUrl).toBe('http://localhost:3010')
})

it('infers auth mode from lightning flag', () => {
  const config = loadConfig({
    upstream: 'http://localhost:11434',
    lightning: 'phoenixd',
    lightningKey: 'pw',
  })
  expect(config.authMode).toBe('lightning')
})

it('defaults auth mode to open when no lightning', () => {
  const config = loadConfig({ upstream: 'http://localhost:11434' })
  expect(config.authMode).toBe('open')
})

it('allows explicit auth mode override', () => {
  const config = loadConfig({
    upstream: 'http://localhost:11434',
    lightning: 'phoenixd',
    lightningKey: 'pw',
    authMode: 'open',
  })
  expect(config.authMode).toBe('open')
})

it('errors when auth is lightning but no lightning backend', () => {
  expect(() => loadConfig({
    upstream: 'http://localhost:11434',
    authMode: 'lightning',
  })).toThrow(/auth mode 'lightning' requires --lightning/)
})

it('errors when auth is allowlist but allowlist is empty', () => {
  expect(() => loadConfig({
    upstream: 'http://localhost:11434',
    authMode: 'allowlist',
  })).toThrow(/auth mode 'allowlist' requires --allowlist/)
})

it('accepts allowlist config', () => {
  const config = loadConfig({
    upstream: 'http://localhost:11434',
    authMode: 'allowlist',
    allowlist: ['npub1abc', 'secret123'],
  })
  expect(config.authMode).toBe('allowlist')
  expect(config.allowlist).toEqual(['npub1abc', 'secret123'])
})

it('sets flatPricing true when price is set via CLI args', () => {
  const config = loadConfig({ upstream: 'http://localhost:11434', price: 5 })
  expect(config.flatPricing).toBe(true)
  expect(config.price).toBe(5)
  // pricing.default should NOT be affected by flat price
  expect(config.pricing.default).toBe(1)
})

it('sets flatPricing false when pricing.models is in file config', () => {
  const config = loadConfig(
    { upstream: 'http://localhost:11434' },
    {},
    { pricing: { default: 2, models: { llama3: 3 } } },
  )
  expect(config.flatPricing).toBe(false)
  // pricing.default should come from file config
  expect(config.pricing.default).toBe(2)
})

it('sets flatPricing false when pricing.default is in file config (no models)', () => {
  const config = loadConfig(
    { upstream: 'http://localhost:11434' },
    {},
    { pricing: { default: 2 } },
  )
  expect(config.flatPricing).toBe(false)
  expect(config.pricing.default).toBe(2)
})

it('CLI --price wins over file pricing.models (flat mode)', () => {
  const config = loadConfig(
    { upstream: 'http://localhost:11434', price: 5 },
    {},
    { pricing: { default: 2, models: { llama3: 3 } } },
  )
  expect(config.flatPricing).toBe(true)
  expect(config.price).toBe(5)
  // per-token pricing still populated for advanced use
  expect(config.pricing.default).toBe(2)
  expect(config.pricing.models.llama3).toBe(3)
})

it('defaults to flat pricing with price=1 when no pricing configured', () => {
  const config = loadConfig({ upstream: 'http://localhost:11434' })
  expect(config.flatPricing).toBe(true)
  expect(config.price).toBe(1)
})

it('reads lightning config from env vars', () => {
  const config = loadConfig(
    { upstream: 'http://localhost:11434' },
    { LIGHTNING_BACKEND: 'lnbits', LIGHTNING_KEY: 'apikey', LIGHTNING_URL: 'https://my.lnbits.com' },
  )
  expect(config.lightning).toBe('lnbits')
  expect(config.lightningKey).toBe('apikey')
  expect(config.lightningUrl).toBe('https://my.lnbits.com')
})

it('reads auth mode from env var', () => {
  const config = loadConfig(
    { upstream: 'http://localhost:11434' },
    { AUTH_MODE: 'open' },
  )
  expect(config.authMode).toBe('open')
})

it('reads tunnel config from env and CLI', () => {
  const withEnv = loadConfig(
    { upstream: 'http://localhost:11434' },
    { TUNNEL: 'false' },
  )
  expect(withEnv.tunnel).toBe(false)

  const withCli = loadConfig({
    upstream: 'http://localhost:11434',
    noTunnel: true,
  })
  expect(withCli.tunnel).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run src/config.test.ts`
Expected: FAIL — new properties don't exist on types

- [ ] **Step 3: Update interfaces and loadConfig**

In `src/config.ts`, update the three interfaces:

```typescript
import type { LightningBackend } from '@thecryptodonkey/toll-booth'

export interface CliArgs {
  upstream?: string
  port?: number
  config?: string
  price?: number
  maxConcurrent?: number
  storage?: string
  dbPath?: string
  freeTier?: number
  trustProxy?: boolean
  rootKey?: string
  // New fields:
  lightning?: string
  lightningUrl?: string
  lightningKey?: string
  authMode?: string
  allowlist?: string[]
  allowlistFile?: string
  noTunnel?: boolean
}

export interface FileConfig {
  upstream?: string
  port?: number
  rootKey?: string
  storage?: string
  dbPath?: string
  pricing?: { default?: number; models?: Record<string, number> }
  freeTier?: { requestsPerDay?: number }
  capacity?: { maxConcurrent?: number }
  tiers?: Array<{ amountSats: number; creditSats: number; label: string }>
  trustProxy?: boolean
  estimatedCostSats?: number
  maxBodySize?: number
  // New fields:
  lightning?: string
  lightningUrl?: string
  lightningKey?: string
  auth?: string
  allowlist?: string[]
  price?: number
  tunnel?: boolean
}

export interface TokenTollConfig {
  upstream: string
  port: number
  rootKey: string
  rootKeyGenerated: boolean
  storage: 'memory' | 'sqlite'
  dbPath: string
  pricing: ModelPricing
  freeTier: { requestsPerDay: number }
  capacity: { maxConcurrent: number }
  tiers: Array<{ amountSats: number; creditSats: number; label: string }>
  trustProxy: boolean
  estimatedCostSats: number
  maxBodySize: number
  models?: string[]
  // New fields:
  lightning?: 'phoenixd' | 'lnbits' | 'lnd' | 'cln'
  lightningUrl?: string
  lightningKey?: string
  authMode: 'open' | 'lightning' | 'allowlist'
  allowlist: string[]
  flatPricing: boolean
  /** Flat per-request price in sats (only used when flatPricing is true). */
  price: number
  tunnel: boolean
  /** Lightning backend instance (created externally, threaded to server). */
  backend?: LightningBackend
}
```

**Critical: Pricing field separation.** The existing `args.price` currently feeds `pricing.default` (per-1k-token rate). The new `config.price` is a separate field for flat per-request pricing. These must NOT collide:

```typescript
const LIGHTNING_URL_DEFAULTS: Record<string, string> = {
  phoenixd: 'http://localhost:9740',
  lnbits: 'https://legend.lnbits.com',
  lnd: 'https://localhost:8080',
  cln: 'http://localhost:3010',
}

// Inside loadConfig, after existing fields:

// Lightning backend config
const lightning = (args.lightning ?? env.LIGHTNING_BACKEND ?? file.lightning) as TokenTollConfig['lightning']
const lightningUrl = args.lightningUrl ?? env.LIGHTNING_URL ?? file.lightningUrl
  ?? (lightning ? LIGHTNING_URL_DEFAULTS[lightning] : undefined)
const lightningKey = args.lightningKey ?? env.LIGHTNING_KEY ?? file.lightningKey

// Auth mode inference
const explicitAuth = args.authMode ?? env.AUTH_MODE ?? file.auth
let authMode: TokenTollConfig['authMode']
if (explicitAuth) {
  authMode = explicitAuth as TokenTollConfig['authMode']
  if (authMode === 'lightning' && !lightning) {
    throw new Error("auth mode 'lightning' requires --lightning <backend>")
  }
} else {
  authMode = lightning ? 'lightning' : 'open'
}

// Allowlist
const allowlist = args.allowlist ?? file.allowlist ?? []
if (authMode === 'allowlist' && allowlist.length === 0) {
  throw new Error("auth mode 'allowlist' requires --allowlist <keys> or --allowlist-file <path>")
}

// Pricing: two separate concerns
// 1. pricing.default / pricing.models — per-token pricing (existing, for config file users)
// 2. config.price / config.flatPricing — flat per-request pricing (CLI quick-start)
//
// args.price NOW means flat per-request price, NOT pricing.default.
// pricing.default comes from env DEFAULT_PRICE or file pricing.default only.
const pricingDefault = (env.DEFAULT_PRICE ? parseInt(env.DEFAULT_PRICE, 10) : undefined)
  ?? file.pricing?.default
  ?? 1

const pricing: ModelPricing = {
  default: pricingDefault,
  models: file.pricing?.models ?? {},
}

// Flat pricing determination
// Flat mode activates when: (a) explicit --price / file.price is set, OR
// (b) no pricing config exists at all (quick-start default).
// Any file `pricing` block (even just `pricing.default`) opts into per-token mode.
const flatPrice = args.price ?? file.price  // only explicit flat price triggers flat mode
const hasPricingConfig = file.pricing !== undefined
const flatPricing = flatPrice !== undefined || !hasPricingConfig
const price = flatPrice ?? 1

// Tunnel
const tunnelEnv = env.TUNNEL !== undefined ? env.TUNNEL !== 'false' : undefined
const tunnel = args.noTunnel === true ? false : (tunnelEnv ?? file.tunnel ?? true)
```

Note: the existing `args.price` case in `parseArgs` still populates `args.price`, but it now feeds `config.price` (flat pricing), not `pricing.default`. The old test `'env vars override config file'` that checks `config.pricing.default` via `DEFAULT_PRICE` env var still works because that path is unchanged. But any test that passes `args.price` and expects `pricing.default` to change must be updated — it now sets `config.price` instead.

Add all new fields to the return object in `loadConfig`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run src/config.test.ts`
Expected: All PASS (check existing tests too — the `args.price` semantic change may require updating the existing `'env vars override config file'` test)

- [ ] **Step 5: Commit**

```bash
cd /Users/darren/WebstormProjects/token-toll
git add src/config.ts src/config.test.ts
git commit -m "feat: extend config with lightning, auth, pricing, and tunnel fields"
```

---

### Task 2: Lightning backend factory

**Files:**
- Create: `src/lightning.ts`
- Create: `src/lightning.test.ts`

- [ ] **Step 1: Write failing tests for backend factory**

Create `src/lightning.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createLightningBackend } from './lightning.js'

describe('createLightningBackend', () => {
  it('returns undefined when no backend specified', () => {
    expect(createLightningBackend({})).toBeUndefined()
  })

  it('creates phoenixd backend', () => {
    const backend = createLightningBackend({
      lightning: 'phoenixd',
      lightningUrl: 'http://localhost:9740',
      lightningKey: 'mypassword',
    })
    expect(backend).toBeDefined()
    expect(backend!.createInvoice).toBeTypeOf('function')
    expect(backend!.checkInvoice).toBeTypeOf('function')
  })

  it('creates lnbits backend', () => {
    const backend = createLightningBackend({
      lightning: 'lnbits',
      lightningUrl: 'https://legend.lnbits.com',
      lightningKey: 'apikey',
    })
    expect(backend).toBeDefined()
  })

  it('creates lnd backend with hex macaroon', () => {
    const backend = createLightningBackend({
      lightning: 'lnd',
      lightningUrl: 'https://localhost:8080',
      lightningKey: '0201036c6e640004',
    })
    expect(backend).toBeDefined()
  })

  it('creates cln backend', () => {
    const backend = createLightningBackend({
      lightning: 'cln',
      lightningUrl: 'http://localhost:3010',
      lightningKey: 'rune_abc',
    })
    expect(backend).toBeDefined()
  })

  it('throws on missing key', () => {
    expect(() => createLightningBackend({
      lightning: 'phoenixd',
      lightningUrl: 'http://localhost:9740',
    })).toThrow(/--lightning-key is required/)
  })

  it('throws on unknown backend', () => {
    expect(() => createLightningBackend({
      lightning: 'unknown' as any,
      lightningUrl: 'http://x',
      lightningKey: 'k',
    })).toThrow(/Unknown lightning backend/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run src/lightning.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the backend factory**

Create `src/lightning.ts`:

```typescript
import type { LightningBackend } from '@thecryptodonkey/toll-booth'
import {
  phoenixdBackend,
  lnbitsBackend,
  lndBackend,
  clnBackend,
} from '@thecryptodonkey/toll-booth'

export interface LightningConfig {
  lightning?: string
  lightningUrl?: string
  lightningKey?: string
}

const HEX_RE = /^[0-9a-fA-F]+$/

/**
 * Creates a Lightning backend from CLI/config options.
 * Returns undefined if no backend is configured.
 */
export function createLightningBackend(config: LightningConfig): LightningBackend | undefined {
  if (!config.lightning) return undefined

  if (!config.lightningKey) {
    throw new Error('--lightning-key is required when --lightning is set')
  }

  if (!config.lightningUrl) {
    throw new Error('--lightning-url is required when --lightning is set')
  }

  const url = config.lightningUrl

  switch (config.lightning) {
    case 'phoenixd':
      return phoenixdBackend({ url, password: config.lightningKey })

    case 'lnbits':
      return lnbitsBackend({ url, apiKey: config.lightningKey })

    case 'lnd': {
      // Hex string = inline macaroon, otherwise = file path
      const isHex = HEX_RE.test(config.lightningKey)
      return lndBackend({
        url,
        ...(isHex
          ? { macaroon: config.lightningKey }
          : { macaroonPath: config.lightningKey }),
      })
    }

    case 'cln':
      return clnBackend({ url, rune: config.lightningKey })

    default:
      throw new Error(`Unknown lightning backend: ${config.lightning}`)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run src/lightning.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/darren/WebstormProjects/token-toll
git add src/lightning.ts src/lightning.test.ts
git commit -m "feat: add lightning backend factory for phoenixd, lnbits, lnd, cln"
```

---

### Task 3: Thread backend into server + flat pricing

**Files:**
- Modify: `src/server.ts`
- Modify: `src/server.test.ts`
- Modify: `src/proxy/handler.ts`
- Modify: `src/proxy/handler.test.ts`

- [ ] **Step 1: Update existing server test config to include new required fields**

In `src/server.test.ts`, update the config object in the existing test to include:
```typescript
authMode: 'lightning' as const,
allowlist: [],
flatPricing: false,
price: 1,
tunnel: false,
```
This prevents breakage from the Task 1 interface changes.

- [ ] **Step 2: Write failing test for backend threading**

Add to `src/server.test.ts` (inside the existing describe block, so it has access to `upstreamUrl`):

```typescript
it('passes lightning backend to toll-booth when configured', async () => {
  const mockBackend = {
    createInvoice: async () => ({ bolt11: 'lnbc...', paymentHash: 'a'.repeat(64) }),
    checkInvoice: async () => ({ paid: false }),
  }

  const { app } = createTokenTollServer({
    upstream: upstreamUrl,
    port: 0,
    rootKey: 'a'.repeat(64),
    rootKeyGenerated: false,
    storage: 'memory',
    dbPath: '',
    pricing: { default: 1, models: {} },
    freeTier: { requestsPerDay: 0 },
    capacity: { maxConcurrent: 0 },
    tiers: [{ amountSats: 1000, creditSats: 1000, label: '1k sats' }],
    trustProxy: false,
    estimatedCostSats: 10,
    maxBodySize: 10 * 1024 * 1024,
    authMode: 'lightning',
    allowlist: [],
    flatPricing: true,
    price: 1,
    tunnel: false,
    backend: mockBackend,
  })

  const res = await app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama3', messages: [] }),
  })
  expect(res.status).toBe(402)
})
```

- [ ] **Step 3: Write failing tests for flat pricing (non-streaming + streaming)**

Add to `src/proxy/handler.test.ts` (inside the existing describe block, to access `upstreamUrl` and mock upstream):

```typescript
it('skips reconciliation when flatPricing is true (non-streaming)', async () => {
  let reconcileCalled = false
  const capacity = new CapacityTracker(0)
  const handler = createProxyHandler({
    upstream: upstreamUrl,
    pricing: { default: 1, models: {} },
    capacity,
    reconcile: () => { reconcileCalled = true; return { adjusted: false, newBalance: 0, delta: 0 } },
    maxBodySize: 10 * 1024 * 1024,
    flatPricing: true,
  })

  const req = new Request(`http://test/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'test', messages: [] }),
  })
  await handler(req, 'a'.repeat(64))

  expect(reconcileCalled).toBe(false)
})

it('skips reconciliation when flatPricing is true (streaming)', async () => {
  let reconcileCalled = false
  const capacity = new CapacityTracker(0)
  const handler = createProxyHandler({
    upstream: upstreamUrl,
    pricing: { default: 1, models: {} },
    capacity,
    reconcile: () => { reconcileCalled = true; return { adjusted: false, newBalance: 0, delta: 0 } },
    maxBodySize: 10 * 1024 * 1024,
    flatPricing: true,
  })

  const req = new Request(`http://test/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'test', messages: [], stream: true }),
  })
  const res = await handler(req, 'a'.repeat(64))

  // Consume stream to trigger onComplete
  if (res.body) {
    const reader = res.body.getReader()
    while (!(await reader.read()).done) { /* drain */ }
  }

  expect(reconcileCalled).toBe(false)
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run src/server.test.ts src/proxy/handler.test.ts`
Expected: FAIL — new config fields not recognised, `flatPricing` not in ProxyDeps

- [ ] **Step 5: Update server.ts — thread backend + import LightningBackend type**

In `src/server.ts`:

1. Add import: `import type { LightningBackend } from '@thecryptodonkey/toll-booth'`
2. Pass `backend: config.backend` to `createTollBooth()`

```typescript
const engine = createTollBooth({
  rootKey: config.rootKey,
  storage,
  upstream: config.upstream,
  backend: config.backend,  // NEW: thread Lightning backend
  pricing: { ... },
  ...
})
```

3. **Also** pass `backend: config.backend` to `tollBooth.createPaymentApp()` — without this, payment routes (`/create-invoice`, `/invoice-status`) will use synthetic/Cashu-only mode and cannot create real Lightning invoices:

```typescript
const paymentApp = tollBooth.createPaymentApp({
  storage,
  rootKey: config.rootKey,
  tiers: config.tiers,
  defaultAmount: config.tiers[0]?.amountSats ?? 1000,
  backend: config.backend,  // NEW: thread Lightning backend here too
})
```

4. Pass `flatPricing: config.flatPricing` to `createProxyHandler()`

- [ ] **Step 6: Update handler.ts for flat pricing**

In `src/proxy/handler.ts`:

1. Add `flatPricing?: boolean` to `ProxyDeps`
2. In the streaming callback, wrap the reconcile call:
```typescript
if (!deps.flatPricing && paymentHash) {
  const satCost = tokenCostToSats(tokenCount, pricePerThousand)
  deps.reconcile(paymentHash, satCost)
}
```
3. In the non-streaming path, same:
```typescript
if (!deps.flatPricing && paymentHash) {
  deps.reconcile(paymentHash, satCost)
}
```
4. In upstream error/refund paths, always refund regardless of pricing mode — users should not be charged when the upstream fails:
```typescript
// Error paths: always refund (even in flat pricing mode)
if (paymentHash) {
  deps.reconcile(paymentHash, 0)
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run src/config.test.ts src/lightning.test.ts src/server.test.ts src/proxy/handler.test.ts`
Expected: All PASS. Note: do NOT run full suite yet — e2e tests need config shape updates (Task 10).

- [ ] **Step 8: Commit**

```bash
cd /Users/darren/WebstormProjects/token-toll
git add src/server.ts src/server.test.ts src/proxy/handler.ts src/proxy/handler.test.ts
git commit -m "feat: thread lightning backend to toll-booth and add flat pricing mode"
```

---

## Chunk 2: Auth Middleware

### Task 4: Allowlist identity extraction (Bearer secrets)

**Files:**
- Create: `src/auth/allowlist.ts`
- Create: `src/auth/allowlist.test.ts`

- [ ] **Step 1: Write failing tests for allowlist**

Create `src/auth/allowlist.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { checkAllowlist } from './allowlist.js'

describe('checkAllowlist', () => {
  // Use secrets that cannot be confused with hex pubkeys (64-char hex)
  const secrets = ['secret-abc', 'secret-xyz']

  it('allows request with valid Bearer secret', () => {
    const result = checkAllowlist('Bearer secret-abc', secrets, { url: '', method: '' })
    expect(result.allowed).toBe(true)
  })

  it('rejects request with invalid Bearer secret', () => {
    const result = checkAllowlist('Bearer wrong-secret', secrets, { url: '', method: '' })
    expect(result.allowed).toBe(false)
  })

  it('rejects request with no auth header', () => {
    const result = checkAllowlist(undefined, secrets, { url: '', method: '' })
    expect(result.allowed).toBe(false)
  })

  it('rejects request with non-Bearer/non-Nostr scheme', () => {
    const result = checkAllowlist('Basic dXNlcjpwYXNz', secrets, { url: '', method: '' })
    expect(result.allowed).toBe(false)
  })

  it('handles empty allowlist', () => {
    const result = checkAllowlist('Bearer anything', [], { url: '', method: '' })
    expect(result.allowed).toBe(false)
  })

  it('does not treat hex pubkeys as Bearer secrets', () => {
    // A 64-char hex string in the allowlist should NOT match as a Bearer secret
    const hexPubkey = 'a'.repeat(64)
    const result = checkAllowlist(`Bearer ${hexPubkey}`, [hexPubkey], { url: '', method: '' })
    expect(result.allowed).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run src/auth/allowlist.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement allowlist checker**

Create `src/auth/allowlist.ts`:

```typescript
export interface AllowlistResult {
  allowed: boolean
  identity?: string
}

export interface RequestContext {
  url: string
  method: string
}

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/

/**
 * Checks whether the Authorization header matches an entry in the allowlist.
 *
 * Identity types:
 * - Bearer <secret> — matched against non-pubkey entries (strings that are
 *   NOT 64-char hex and NOT npub1-prefixed)
 * - Nostr <base64-event> — NIP-98 verification against pubkey entries
 *
 * Security: hex pubkeys and npub entries are NEVER treated as Bearer secrets.
 * Only entries that don't look like pubkeys are valid Bearer secrets.
 */
/**
 * @param now - Optional Unix timestamp (seconds) for testing. Defaults to current time.
 */
export function checkAllowlist(
  authHeader: string | undefined,
  allowlist: string[],
  request: RequestContext,
  now?: number,
): AllowlistResult {
  if (!authHeader || allowlist.length === 0) {
    return { allowed: false }
  }

  const spaceIdx = authHeader.indexOf(' ')
  if (spaceIdx === -1) return { allowed: false }

  const scheme = authHeader.slice(0, spaceIdx)
  const credential = authHeader.slice(spaceIdx + 1)

  if (scheme === 'Bearer') {
    // Only match entries that are NOT pubkeys (hex or npub)
    const secrets = allowlist.filter(
      entry => !entry.startsWith('npub1') && !HEX_PUBKEY_RE.test(entry),
    )
    if (secrets.includes(credential)) {
      return { allowed: true, identity: credential.slice(0, 8) + '...' }
    }
    return { allowed: false }
  }

  if (scheme === 'Nostr') {
    return verifyNip98(credential, allowlist, request, now)
  }

  return { allowed: false }
}

/**
 * Verify a NIP-98 HTTP Auth event against the allowlist of pubkeys.
 * Stub: returns { allowed: false } until @noble/curves is wired in (Task 5).
 */
function verifyNip98(
  _base64Event: string,
  _allowlist: string[],
  _request: RequestContext,
  _now?: number,
): AllowlistResult {
  return { allowed: false }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run src/auth/allowlist.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/darren/WebstormProjects/token-toll
git add src/auth/allowlist.ts src/auth/allowlist.test.ts
git commit -m "feat: add allowlist identity checker with Bearer secret support"
```

---

### Task 5: NIP-98 verification (Nostr pubkey allowlist)

**Files:**
- Modify: `src/auth/allowlist.ts`
- Modify: `src/auth/allowlist.test.ts`
- Modify: `package.json` (add `@noble/curves`, `@scure/base`)

- [ ] **Step 1: Install dependencies**

Run: `cd /Users/darren/WebstormProjects/token-toll && npm install @noble/curves @scure/base`

Note: `@scure/base` is a transitive dependency of `@noble/curves` but we depend on it directly for bech32 decode (npub → hex pubkey).

- [ ] **Step 2: Write failing tests for NIP-98 verification**

Add to `src/auth/allowlist.test.ts`:

```typescript
import { schnorr } from '@noble/curves/secp256k1'
import { bytesToHex } from '@noble/curves/abstract/utils'
import { bech32 } from '@scure/base'
import { createHash } from 'node:crypto'

function hexToNpub(hex: string): string {
  const words = bech32.toWords(Buffer.from(hex, 'hex'))
  return bech32.encode('npub', words)
}

function createNip98Token(privateKey: Uint8Array, url: string, method: string, createdAt?: number): string {
  const pubkey = bytesToHex(schnorr.getPublicKey(privateKey))
  const event = {
    pubkey,
    created_at: createdAt ?? Math.floor(Date.now() / 1000),
    kind: 27235,
    tags: [['u', url], ['method', method]],
    content: '',
  }
  const serialised = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
  const id = createHash('sha256').update(serialised).digest('hex')
  const sig = bytesToHex(schnorr.sign(id, privateKey))
  return btoa(JSON.stringify({ ...event, id, sig }))
}

describe('NIP-98 allowlist', () => {
  const url = 'http://localhost:3000/v1/chat/completions'
  const method = 'POST'
  // Use a fixed `now` for all tests to avoid flakiness from clock drift or slow CI
  const now = Math.floor(Date.now() / 1000)

  it('allows request with valid NIP-98 event from allowlisted hex pubkey', () => {
    const privKey = schnorr.utils.randomPrivateKey()
    const pubkey = bytesToHex(schnorr.getPublicKey(privKey))
    const token = createNip98Token(privKey, url, method, now)

    const result = checkAllowlist(`Nostr ${token}`, [pubkey], { url, method }, now)
    expect(result.allowed).toBe(true)
  })

  it('allows request with valid NIP-98 event from allowlisted npub', () => {
    const privKey = schnorr.utils.randomPrivateKey()
    const pubkey = bytesToHex(schnorr.getPublicKey(privKey))
    const npub = hexToNpub(pubkey)
    const token = createNip98Token(privKey, url, method, now)

    const result = checkAllowlist(`Nostr ${token}`, [npub], { url, method }, now)
    expect(result.allowed).toBe(true)
  })

  it('rejects NIP-98 event from non-allowlisted pubkey', () => {
    const privKey = schnorr.utils.randomPrivateKey()
    const token = createNip98Token(privKey, url, method, now)
    const otherPubkey = bytesToHex(schnorr.getPublicKey(schnorr.utils.randomPrivateKey()))

    const result = checkAllowlist(`Nostr ${token}`, [otherPubkey], { url, method }, now)
    expect(result.allowed).toBe(false)
  })

  it('rejects NIP-98 event with wrong URL', () => {
    const privKey = schnorr.utils.randomPrivateKey()
    const pubkey = bytesToHex(schnorr.getPublicKey(privKey))
    const token = createNip98Token(privKey, 'http://evil.com/v1/chat/completions', method, now)

    const result = checkAllowlist(`Nostr ${token}`, [pubkey], { url, method }, now)
    expect(result.allowed).toBe(false)
  })

  it('rejects NIP-98 event with wrong method', () => {
    const privKey = schnorr.utils.randomPrivateKey()
    const pubkey = bytesToHex(schnorr.getPublicKey(privKey))
    const token = createNip98Token(privKey, url, 'GET', now)

    const result = checkAllowlist(`Nostr ${token}`, [pubkey], { url, method }, now)
    expect(result.allowed).toBe(false)
  })

  it('rejects NIP-98 event with expired timestamp', () => {
    const privKey = schnorr.utils.randomPrivateKey()
    const pubkey = bytesToHex(schnorr.getPublicKey(privKey))
    const expired = now - 120  // 2 minutes before `now`
    const token = createNip98Token(privKey, url, method, expired)

    const result = checkAllowlist(`Nostr ${token}`, [pubkey], { url, method }, now)
    expect(result.allowed).toBe(false)
  })

  it('rejects malformed NIP-98 event', () => {
    const result = checkAllowlist(`Nostr ${btoa('not json')}`, ['a'.repeat(64)], { url, method }, now)
    expect(result.allowed).toBe(false)
  })

  it('rejects NIP-98 with invalid base64', () => {
    const result = checkAllowlist('Nostr !!!invalid!!!', ['a'.repeat(64)], { url, method }, now)
    expect(result.allowed).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run src/auth/allowlist.test.ts`
Expected: FAIL — verifyNip98 returns `{ allowed: false }` always

- [ ] **Step 4: Implement NIP-98 verification**

Replace the `verifyNip98` stub in `src/auth/allowlist.ts`:

```typescript
import { schnorr } from '@noble/curves/secp256k1'
import { createHash } from 'node:crypto'
import { bech32 } from '@scure/base'

interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/**
 * Decode an npub (bech32-encoded) to a hex pubkey.
 */
function npubToHex(npub: string): string | null {
  try {
    const { prefix, words } = bech32.decode(npub)
    if (prefix !== 'npub') return null
    const bytes = bech32.fromWords(words)
    return Buffer.from(bytes).toString('hex')
  } catch {
    return null
  }
}

/**
 * Normalise allowlist entries to hex pubkeys.
 * Returns only the pubkey entries (npub or hex), not shared secrets.
 */
function extractPubkeys(allowlist: string[]): string[] {
  const pubkeys: string[] = []
  for (const entry of allowlist) {
    if (entry.startsWith('npub1')) {
      const hex = npubToHex(entry)
      if (hex) pubkeys.push(hex)
    } else if (HEX_PUBKEY_RE.test(entry)) {
      pubkeys.push(entry)
    }
    // Shared secrets are ignored here
  }
  return pubkeys
}

function verifyNip98(
  base64Event: string,
  allowlist: string[],
  request: RequestContext,
  nowOverride?: number,
): AllowlistResult {
  try {
    const json = Buffer.from(base64Event, 'base64').toString('utf-8')
    const event: NostrEvent = JSON.parse(json)

    // Must be kind 27235 (NIP-98 HTTP Auth)
    if (event.kind !== 27235) return { allowed: false }

    // Check created_at is within 60 seconds (injectable for testing)
    const now = nowOverride ?? Math.floor(Date.now() / 1000)
    if (Math.abs(now - event.created_at) > 60) return { allowed: false }

    // Validate URL and method tags match the actual request
    const urlTag = event.tags.find(t => t[0] === 'u')?.[1]
    const methodTag = event.tags.find(t => t[0] === 'method')?.[1]
    if (urlTag !== request.url) return { allowed: false }
    if (methodTag?.toUpperCase() !== request.method.toUpperCase()) return { allowed: false }

    // Verify event ID
    const serialised = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
    const expectedId = createHash('sha256').update(serialised).digest('hex')
    if (event.id !== expectedId) return { allowed: false }

    // Verify schnorr signature
    const valid = schnorr.verify(event.sig, event.id, event.pubkey)
    if (!valid) return { allowed: false }

    // Check pubkey against allowlist (normalise npub → hex)
    const allowedPubkeys = extractPubkeys(allowlist)
    if (allowedPubkeys.includes(event.pubkey)) {
      return { allowed: true, identity: event.pubkey.slice(0, 8) + '...' }
    }

    return { allowed: false }
  } catch {
    return { allowed: false }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run src/auth/allowlist.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/darren/WebstormProjects/token-toll
git add src/auth/allowlist.ts src/auth/allowlist.test.ts package.json package-lock.json
git commit -m "feat: add NIP-98 schnorr verification for Nostr pubkey allowlist"
```

---

### Task 6: Auth middleware router

**Files:**
- Create: `src/auth/middleware.ts`
- Create: `src/auth/middleware.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write failing tests for auth middleware**

Create `src/auth/middleware.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createAuthMiddleware } from './middleware.js'

describe('createAuthMiddleware', () => {
  it('passes all requests in open mode', async () => {
    const app = new Hono()
    const middleware = createAuthMiddleware({ authMode: 'open', allowlist: [] })
    app.use('/v1/*', middleware)
    app.post('/v1/chat/completions', (c) => c.json({ ok: true }))

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
  })

  it('returns 403 for unauthorised allowlist request', async () => {
    const app = new Hono()
    const middleware = createAuthMiddleware({
      authMode: 'allowlist',
      allowlist: ['secret-abc'],
    })
    app.use('/v1/*', middleware)
    app.post('/v1/chat/completions', (c) => c.json({ ok: true }))

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(403)
  })

  it('passes authorised allowlist request', async () => {
    const app = new Hono()
    const middleware = createAuthMiddleware({
      authMode: 'allowlist',
      allowlist: ['secret-abc'],
    })
    app.use('/v1/*', middleware)
    app.post('/v1/chat/completions', (c) => c.json({ ok: true }))

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer secret-abc',
      },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
  })

  it('passes through in lightning mode (toll-booth handles auth separately)', async () => {
    const app = new Hono()
    const middleware = createAuthMiddleware({ authMode: 'lightning', allowlist: [] })
    app.use('/v1/*', middleware)
    app.post('/v1/chat/completions', (c) => c.json({ ok: true }))

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    // Lightning middleware is a no-op — toll-booth is mounted separately
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run src/auth/middleware.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement auth middleware**

Create `src/auth/middleware.ts`:

```typescript
import type { MiddlewareHandler } from 'hono'
import { checkAllowlist } from './allowlist.js'

export interface AuthMiddlewareConfig {
  authMode: 'open' | 'lightning' | 'allowlist'
  allowlist: string[]
}

/**
 * Creates Hono middleware that handles auth based on the configured mode.
 *
 * - open: pass through (no checks)
 * - allowlist: check Authorization header against allowlist
 * - lightning: pass through — toll-booth's authMiddleware is mounted separately
 *   in server.ts for the lightning path
 */
export function createAuthMiddleware(config: AuthMiddlewareConfig): MiddlewareHandler {
  if (config.authMode === 'allowlist') {
    return async (c, next) => {
      const authHeader = c.req.header('Authorization')
      const requestUrl = c.req.url
      const requestMethod = c.req.method
      const result = checkAllowlist(authHeader, config.allowlist, {
        url: requestUrl,
        method: requestMethod,
      })
      if (!result.allowed) {
        return c.json({ error: 'Forbidden' }, 403)
      }
      await next()
    }
  }

  // open mode and lightning mode: pass through
  // (lightning auth is handled by toll-booth's own middleware, mounted separately)
  return async (_c, next) => { await next() }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run src/auth/middleware.test.ts`
Expected: All PASS

- [ ] **Step 5: Wire auth middleware into server.ts**

In `src/server.ts`, replace the hardcoded `app.use('/v1/*', tollBooth.authMiddleware)` with conditional logic:

```typescript
import { createAuthMiddleware } from './auth/middleware.js'

// After creating tollBooth:
if (config.authMode === 'lightning') {
  app.use('/v1/*', tollBooth.authMiddleware)
} else {
  const authMiddleware = createAuthMiddleware({
    authMode: config.authMode,
    allowlist: config.allowlist,
  })
  app.use('/v1/*', authMiddleware)
}
```

Update the route handlers — `tollBoothPaymentHash` is only set by toll-booth in lightning mode:

```typescript
app.post('/v1/chat/completions', async (c: Context<TollBoothEnv>) => {
  const paymentHash = config.authMode === 'lightning' ? c.get('tollBoothPaymentHash') : undefined
  return proxyHandler(c.req.raw, paymentHash)
})
// Same for /v1/completions and /v1/embeddings
```

Note on types: The Hono app is typed as `Hono<TollBoothEnv>`. In open/allowlist mode, the `TollBoothEnv` context variables are never set — `c.get('tollBoothPaymentHash')` would return `undefined`. The `config.authMode === 'lightning'` guard ensures we only access it when toll-booth has populated it.

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
cd /Users/darren/WebstormProjects/token-toll
git add src/auth/middleware.ts src/auth/middleware.test.ts src/server.ts
git commit -m "feat: add auth middleware with open/lightning/allowlist routing"
```

---

## Chunk 3: Tunnel, CLI & Publish

### Task 7: Tunnel manager

**Files:**
- Create: `src/tunnel.ts`
- Create: `src/tunnel.test.ts`

- [ ] **Step 1: Write failing tests for tunnel manager**

Create `src/tunnel.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { findCloudflared, parseTunnelUrl } from './tunnel.js'

describe('parseTunnelUrl', () => {
  it('extracts URL from cloudflared stderr output', () => {
    const lines = [
      '2026-03-12T10:00:00Z INF Starting tunnel',
      '2026-03-12T10:00:01Z INF +-----------------------------------+',
      '2026-03-12T10:00:01Z INF |  Your quick Tunnel has been created!',
      '2026-03-12T10:00:01Z INF +-----------------------------------+',
      '2026-03-12T10:00:01Z INF https://abc-xyz-123.trycloudflare.com',
    ]
    expect(parseTunnelUrl(lines.join('\n'))).toBe('https://abc-xyz-123.trycloudflare.com')
  })

  it('returns undefined when no URL found', () => {
    expect(parseTunnelUrl('some random output')).toBeUndefined()
  })
})

describe('findCloudflared', () => {
  it('returns path or null without throwing', () => {
    const result = findCloudflared()
    expect(result === null || typeof result === 'string').toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run src/tunnel.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement tunnel manager**

Create `src/tunnel.ts`. Uses `execFileSync` (not `execSync`) and `spawn` (not `exec`) to avoid shell injection:

```typescript
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'

/**
 * Check if cloudflared is available on PATH.
 * Returns the path to the binary, or null if not found.
 * Note: uses `which` — works on macOS/Linux, not Windows.
 */
export function findCloudflared(): string | null {
  try {
    const result = execFileSync('which', ['cloudflared'], { encoding: 'utf-8', timeout: 5000 })
    return result.trim() || null
  } catch {
    return null
  }
}

const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/

/**
 * Parse the tunnel URL from cloudflared's stderr output.
 */
export function parseTunnelUrl(output: string): string | undefined {
  const match = output.match(TUNNEL_URL_RE)
  return match?.[0]
}

export interface TunnelResult {
  url?: string
  process?: ChildProcess
  error?: string
}

/**
 * Start a Cloudflare Tunnel pointing at the given local port.
 * Resolves when the tunnel URL is available or after a 10s timeout.
 */
export function startTunnel(port: number): Promise<TunnelResult> {
  const cloudflaredPath = findCloudflared()
  if (!cloudflaredPath) {
    return Promise.resolve({
      error: 'cloudflared not found. Install: brew install cloudflared',
    })
  }

  return new Promise((resolve) => {
    const child = spawn(cloudflaredPath, ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    const timeout = setTimeout(() => {
      // Kill orphaned child on timeout to avoid process leak
      if (!child.killed) child.kill('SIGTERM')
      resolve({ error: 'Tunnel startup timed out (10s)' })
    }, 10_000)

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      const url = parseTunnelUrl(stderr)
      if (url) {
        clearTimeout(timeout)
        resolve({ url, process: child })
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      resolve({ error: `Failed to start cloudflared: ${err.message}` })
    })

    child.on('exit', (code) => {
      clearTimeout(timeout)
      if (code !== null && code !== 0) {
        resolve({ error: `cloudflared exited with code ${code}` })
      }
    })
  })
}

/**
 * Gracefully stop the tunnel process.
 */
export function stopTunnel(child: ChildProcess): void {
  if (!child.killed) {
    child.kill('SIGTERM')
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run src/tunnel.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/darren/WebstormProjects/token-toll
git add src/tunnel.ts src/tunnel.test.ts
git commit -m "feat: add cloudflare tunnel manager with auto-detect and URL parsing"
```

---

### Task 8: Update CLI — new flags, Ollama auto-detect, YAML, tunnel, banner

**Files:**
- Modify: `src/cli.ts`
- Modify: `package.json` (add `js-yaml`, `@types/js-yaml`)

- [ ] **Step 1: Install js-yaml**

Run: `cd /Users/darren/WebstormProjects/token-toll && npm install js-yaml && npm install -D @types/js-yaml`

Verify `js-yaml` is in `dependencies` (not `devDependencies`) in package.json.

- [ ] **Step 2: Update parseArgs with new flags**

In `src/cli.ts`, add new cases to the switch statement:

```typescript
case '--lightning': args.lightning = argv[++i]; break
case '--lightning-url': args.lightningUrl = argv[++i]; break
case '--lightning-key': args.lightningKey = argv[++i]; break
case '--auth': args.authMode = argv[++i]; break
case '--allowlist': args.allowlist = argv[++i].split(','); break
case '--allowlist-file': args.allowlistFile = argv[++i]; break
case '--no-tunnel': args.noTunnel = true; break
```

- [ ] **Step 3: Update loadFileConfig to use js-yaml**

Replace the YAML fallback block:

```typescript
import yaml from 'js-yaml'

// In loadFileConfig, replace the YAML section:
if (configPath.endsWith('.yaml') || configPath.endsWith('.yml')) {
  return yaml.load(content) as Record<string, unknown>
}
return JSON.parse(content)
```

- [ ] **Step 4: Add Ollama auto-detect**

In `main()`, before `loadConfig`, add upstream auto-detection with a clear error message:

```typescript
// Auto-detect Ollama if no upstream specified (check CLI, env, AND file config)
if (!args.upstream && !process.env.UPSTREAM_URL && !fileConfig?.upstream) {
  try {
    const res = await fetch('http://localhost:11434/v1/models', {
      signal: AbortSignal.timeout(2000),
    })
    if (res.ok) {
      args.upstream = 'http://localhost:11434'
      console.log('[token-toll] Ollama detected on :11434')
    }
  } catch {
    // Ollama not found
  }

  // If still no upstream after auto-detect, give a helpful error
  if (!args.upstream && !process.env.UPSTREAM_URL && !fileConfig?.upstream) {
    console.error('[token-toll] No upstream detected. Ollama not found on :11434.')
    console.error('[token-toll] Either start Ollama or pass --upstream <url>')
    process.exit(1)
  }
}
```

- [ ] **Step 5: Add allowlist file loading**

After config loading, if `allowlistFile` is set:

```typescript
// Change config from const to let
let config = loadConfig(args, process.env as Record<string, string>, fileConfig)

if (args.allowlistFile) {
  const content = readFileSync(args.allowlistFile, 'utf-8')
  const entries = content.split('\n').map(l => l.trim()).filter(Boolean)
  config = { ...config, allowlist: [...config.allowlist, ...entries] }
}
```

- [ ] **Step 6: Create Lightning backend and pass to server**

After config loading:

```typescript
import { createLightningBackend } from './lightning.js'

const backend = createLightningBackend(config)
```

Then pass to server:

```typescript
const { app } = createTokenTollServer({ ...config, models, backend })
```

- [ ] **Step 7: Add tunnel lifecycle and graceful shutdown**

Capture the server handle from `serve()` and register shutdown handlers:

```typescript
import { startTunnel, stopTunnel, type TunnelResult } from './tunnel.js'

let tunnelResult: TunnelResult | undefined

const server = serve({ fetch: app.fetch, port: config.port }, async () => {
  // Print banner (step 8)
  // ...

  // Start tunnel if enabled
  if (config.tunnel) {
    tunnelResult = await startTunnel(config.port)
    if (tunnelResult.url) {
      console.log(`  Public:     ${tunnelResult.url}`)
    } else if (tunnelResult.error) {
      console.log(`  Tunnel:     ${tunnelResult.error}`)
    }
  } else {
    console.log('  Tunnel:     disabled')
  }
})

// Clean shutdown: stop tunnel, close HTTP server, then exit
const shutdown = () => {
  if (tunnelResult?.process) stopTunnel(tunnelResult.process)
  server.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
```

- [ ] **Step 8: Update startup banner**

Note: The spec shows a box-drawing banner with `+---+` borders. We use a simpler indented text format for maintainability with variable-length content. The tunnel URL is printed asynchronously after it resolves (Step 7 above).

Replace the existing banner:

```typescript
const lightningLabel = config.lightning
  ? `${config.lightning} (${config.lightningUrl})`
  : 'none (free mode)'
const authLabel = config.authMode === 'lightning'
  ? 'lightning (pay-per-request)'
  : config.authMode === 'allowlist'
    ? `allowlist (${config.allowlist.length} identities)`
    : 'open'
const priceLabel = config.flatPricing
  ? `${config.price} sat/request`
  : `${config.pricing.default} sat/1k tokens`
const autoDetected = !args.upstream && !process.env.UPSTREAM_URL && !fileConfig?.upstream

console.log(`
  token-toll v${version}

  Upstream:   ${config.upstream}${autoDetected ? ' (auto-detected)' : ''}
  Models:     ${models.length > 0 ? models.join(', ') : '(none detected)'}
  Lightning:  ${lightningLabel}
  Auth:       ${authLabel}
  Price:      ${priceLabel}
  Storage:    ${config.storage}${config.storage === 'memory' ? ' (ephemeral)' : ''}
  Local:      http://localhost:${config.port}
${config.rootKeyGenerated ? `
  ! Using auto-generated root key (not persisted across restarts)
  ! Set ROOT_KEY env var for production use` : ''}

  /.well-known/l402  |  /llms.txt  |  /health
`)
```

- [ ] **Step 9: Update printHelp**

Replace the help text to match the spec's CLI flags section:

```typescript
function printHelp(): void {
  console.log(`
  token-toll - Lightning-paid AI inference

  Usage: token-toll [options]

  Upstream:
    --upstream <url>           Upstream API URL (default: auto-detect Ollama on :11434)

  Lightning:
    --lightning <backend>      phoenixd | lnbits | lnd | cln
    --lightning-url <url>      Backend URL (defaults per backend)
    --lightning-key <secret>   Password / API key / macaroon / rune

  Auth:
    --auth <mode>              open | lightning | allowlist (inferred from context)
    --allowlist <keys>         Comma-separated npubs or shared secrets
    --allowlist-file <path>    File with one key per line

  Pricing:
    --price <sats>             Sats per request (default: 1)

  Server:
    --port <number>            Listen port (default: 3000)
    --no-tunnel                Skip Cloudflare Tunnel

  Storage:
    --storage <type>           memory | sqlite (default: memory)
    --db-path <path>           SQLite path (default: ./token-toll.db)

  Other:
    --config <path>            Config file (JSON or YAML)
    --max-concurrent <n>       Max concurrent inference requests
    --free-tier <n>            Free requests per IP per day (default: 0)
    --trust-proxy              Trust X-Forwarded-For headers
    -h, --help                 Show help
    -v, --version              Show version
`)
}
```

- [ ] **Step 10: Run full test suite**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run`
Expected: All tests pass

- [ ] **Step 11: Commit**

```bash
cd /Users/darren/WebstormProjects/token-toll
git add src/cli.ts package.json package-lock.json
git commit -m "feat: update CLI with lightning, auth, tunnel, YAML, and Ollama auto-detect"
```

---

### Task 9: Update exports and package.json for npm publish

**Files:**
- Modify: `src/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Update public exports**

Add to `src/index.ts`:

```typescript
export { createAuthMiddleware, type AuthMiddlewareConfig } from './auth/middleware.js'
export { checkAllowlist, type AllowlistResult } from './auth/allowlist.js'
export { createLightningBackend, type LightningConfig } from './lightning.js'
export { startTunnel, stopTunnel, findCloudflared, parseTunnelUrl } from './tunnel.js'
```

- [ ] **Step 2: Update package.json for npm publish**

Add `files` field and `prepublishOnly` script:

```json
"files": ["dist"],
"scripts": {
  "build": "tsc",
  "test": "vitest run",
  "typecheck": "tsc --noEmit",
  "dev": "tsx src/cli.ts",
  "prepublishOnly": "npm run build"
}
```

- [ ] **Step 3: Verify dependencies are in the right sections**

Check package.json:
- `js-yaml` must be in `dependencies` (not devDependencies)
- `@noble/curves` must be in `dependencies`
- `@scure/base` must be in `dependencies`
- `@types/js-yaml` must be in `devDependencies`

- [ ] **Step 4: Run build to verify everything compiles**

Run: `cd /Users/darren/WebstormProjects/token-toll && npm run build`
Expected: Clean compilation, no errors

- [ ] **Step 5: Verify package contents with dry-run**

Run: `cd /Users/darren/WebstormProjects/token-toll && npm pack --dry-run`
Expected: Only `dist/` files listed, no `src/`, tests, or config files

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
cd /Users/darren/WebstormProjects/token-toll
git add src/index.ts package.json
git commit -m "feat: update exports and package.json for npm publish"
```

---

### Task 10: End-to-end smoke tests

**Files:**
- Modify: `test/e2e/inference.test.ts`

- [ ] **Step 1: Update existing e2e tests to include new required config fields**

The existing e2e tests create `TokenTollConfig` objects that are now missing new required fields. Extract a `baseConfig` helper and add the new fields to all existing test configs:

```typescript
const baseConfig = {
  // ... existing fields ...
  authMode: 'lightning' as const,
  allowlist: [],
  flatPricing: false,
  price: 1,
  tunnel: false,
}
```

Run existing tests first to ensure they still pass after the config shape change.

- [ ] **Step 2: Add e2e tests for new auth modes and flat pricing**

```typescript
describe('open auth mode', () => {
  it('allows unauthenticated requests in open mode', async () => {
    const { app } = createTokenTollServer({
      ...baseConfig,
      authMode: 'open',
      flatPricing: true,
      price: 1,
    })

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(200)
  })
})

describe('allowlist auth mode', () => {
  it('rejects unauthorised requests', async () => {
    const { app } = createTokenTollServer({
      ...baseConfig,
      authMode: 'allowlist',
      allowlist: ['secret-abc'],
      flatPricing: true,
      price: 1,
    })

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3', messages: [] }),
    })
    expect(res.status).toBe(403)
  })

  it('allows authorised requests', async () => {
    const { app } = createTokenTollServer({
      ...baseConfig,
      authMode: 'allowlist',
      allowlist: ['secret-abc'],
      flatPricing: true,
      price: 1,
    })

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer secret-abc',
      },
      body: JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(200)
  })
})

describe('flat pricing mode', () => {
  it('completes request without reconciliation errors in flat pricing mode', async () => {
    const { app } = createTokenTollServer({
      ...baseConfig,
      authMode: 'open',
      flatPricing: true,
      price: 2,
    })

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.choices).toBeDefined()
  })
})
```

- [ ] **Step 3: Run e2e tests**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run test/e2e/`
Expected: All PASS

- [ ] **Step 4: Run full test suite one final time**

Run: `cd /Users/darren/WebstormProjects/token-toll && npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/darren/WebstormProjects/token-toll
git add test/e2e/inference.test.ts
git commit -m "test: add e2e tests for open, allowlist, and flat pricing modes"
```
