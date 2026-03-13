# Observability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add coloured terminal logging for payments, requests, challenges, and errors — with a JSON mode for machine consumption.

**Architecture:** A lightweight `Logger` module (`src/logger.ts`) wraps `process.stderr.write` with coloured pretty-print and JSON formatters. It's created in `cli.ts` and threaded via `TokenTollConfig.logger` to `server.ts`, which wires toll-booth's `onPayment`/`onRequest`/`onChallenge` callbacks and passes the logger to the proxy handler.

**Tech Stack:** TypeScript, Vitest, ANSI escape codes (no dependencies)

**Spec:** `docs/superpowers/specs/2026-03-13-observability-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/logger.ts` | **New** — Logger interface, `createLogger()`, `createNoopLogger()`, pretty + JSON formatters |
| `src/logger.test.ts` | **New** — Unit tests for logger output formatting |
| `src/config.ts` | Add `verbose`, `logFormat`, `logger?` fields; parse new CLI flags and env vars |
| `src/server.ts` | Wire toll-booth event callbacks to logger; pass logger to proxy handler |
| `src/proxy/handler.ts` | Add `logger?` to `ProxyDeps`; replace `console.error` with `logger.error()`; add upstream latency timing |
| `src/cli.ts` | Create logger from config; replace `console.log` startup banner with `logger.info()` |

---

## Chunk 1: Logger module

### Task 1: Create the logger module with tests

**Files:**
- Create: `src/logger.ts`
- Create: `src/logger.test.ts`

- [ ] **Step 1: Write failing tests for the no-op logger**

```typescript
// src/logger.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogger, createNoopLogger, type Logger } from './logger.js'
import type { PaymentEvent, RequestEvent, ChallengeEvent } from '@thecryptodonkey/toll-booth'

const samplePayment: PaymentEvent = {
  timestamp: '2026-03-13T12:00:00.000Z',
  paymentHash: 'ab'.repeat(32),
  amountSats: 21,
  rail: 'l402',
}

const sampleRequest: RequestEvent = {
  timestamp: '2026-03-13T12:00:00.000Z',
  endpoint: '/v1/chat/completions',
  satsDeducted: 1,
  remainingBalance: 79,
  latencyMs: 347,
  authenticated: true,
  clientIp: '192.168.1.1',
}

const sampleChallenge: ChallengeEvent = {
  timestamp: '2026-03-13T12:00:00.000Z',
  endpoint: '/v1/chat/completions',
  amountSats: 100,
  clientIp: '192.168.1.1',
}

describe('Logger', () => {
  describe('createNoopLogger', () => {
    it('does not throw on any method', () => {
      const logger = createNoopLogger()
      expect(() => logger.payment(samplePayment)).not.toThrow()
      expect(() => logger.request(sampleRequest)).not.toThrow()
      expect(() => logger.challenge(sampleChallenge)).not.toThrow()
      expect(() => logger.error('test')).not.toThrow()
      expect(() => logger.info('test')).not.toThrow()
      expect(() => logger.warn('test')).not.toThrow()
    })

    it('does not write to stderr', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
      const logger = createNoopLogger()
      logger.payment(samplePayment)
      logger.request(sampleRequest)
      logger.info('test')
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/logger.test.ts`
Expected: FAIL — cannot find module `./logger.js`

- [ ] **Step 3: Write the logger module — no-op logger first**

```typescript
// src/logger.ts
import type { PaymentEvent, RequestEvent, ChallengeEvent } from '@thecryptodonkey/toll-booth'

export interface Logger {
  challenge(event: ChallengeEvent): void
  payment(event: PaymentEvent): void
  request(event: RequestEvent): void
  error(message: string, context?: Record<string, unknown>): void
  info(message: string): void
  warn(message: string): void
}

export function createNoopLogger(): Logger {
  return {
    challenge() {},
    payment() {},
    request() {},
    error() {},
    info() {},
    warn() {},
  }
}
```

- [ ] **Step 4: Run test to verify no-op logger passes**

Run: `npx vitest run src/logger.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Add failing tests for JSON format logger**

Append to `src/logger.test.ts`:

```typescript
  describe('createLogger (json)', () => {
    let output: string[]
    let writeSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      output = []
      writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        output.push(typeof chunk === 'string' ? chunk : chunk.toString())
        return true
      })
    })

    afterEach(() => {
      writeSpy.mockRestore()
    })

    it('emits payment as JSON line', () => {
      const logger = createLogger({ format: 'json', verbose: false })
      logger.payment(samplePayment)
      expect(output).toHaveLength(1)
      const parsed = JSON.parse(output[0])
      expect(parsed.event).toBe('payment')
      expect(parsed.amountSats).toBe(21)
      expect(parsed.paymentHash).toBe('ab'.repeat(32))
      expect(parsed.rail).toBe('l402')
      expect(parsed.level).toBe('info')
      expect(parsed.ts).toBeDefined()
    })

    it('emits request as JSON line', () => {
      const logger = createLogger({ format: 'json', verbose: false })
      logger.request(sampleRequest)
      const parsed = JSON.parse(output[0])
      expect(parsed.event).toBe('request')
      expect(parsed.endpoint).toBe('/v1/chat/completions')
      expect(parsed.satsDeducted).toBe(1)
      expect(parsed.remainingBalance).toBe(79)
      expect(parsed.latencyMs).toBe(347)
      expect(parsed.clientIp).toBe('192.168.1.1')
    })

    it('emits challenge as JSON line', () => {
      const logger = createLogger({ format: 'json', verbose: false })
      logger.challenge(sampleChallenge)
      const parsed = JSON.parse(output[0])
      expect(parsed.event).toBe('challenge')
      expect(parsed.amountSats).toBe(100)
      expect(parsed.clientIp).toBe('192.168.1.1')
    })

    it('emits error as JSON line', () => {
      const logger = createLogger({ format: 'json', verbose: false })
      logger.error('upstream timeout', { endpoint: '/v1/chat/completions', latencyMs: 5003 })
      const parsed = JSON.parse(output[0])
      expect(parsed.event).toBe('error')
      expect(parsed.level).toBe('error')
      expect(parsed.message).toBe('upstream timeout')
      expect(parsed.endpoint).toBe('/v1/chat/completions')
    })

    it('emits info as JSON line', () => {
      const logger = createLogger({ format: 'json', verbose: false })
      logger.info('server started')
      const parsed = JSON.parse(output[0])
      expect(parsed.event).toBe('info')
      expect(parsed.message).toBe('server started')
    })

    it('emits warn as JSON line', () => {
      const logger = createLogger({ format: 'json', verbose: false })
      logger.warn('high load')
      const parsed = JSON.parse(output[0])
      expect(parsed.event).toBe('warn')
      expect(parsed.level).toBe('warn')
      expect(parsed.message).toBe('high load')
    })
  })
```

- [ ] **Step 6: Run test to verify JSON tests fail**

Run: `npx vitest run src/logger.test.ts`
Expected: FAIL — `createLogger` not exported

- [ ] **Step 7: Implement `createLogger` with JSON formatter**

Add to `src/logger.ts`:

```typescript
export interface LoggerOptions {
  format: 'pretty' | 'json'
  verbose: boolean
}

function jsonLine(obj: Record<string, unknown>): void {
  process.stderr.write(JSON.stringify(obj) + '\n')
}

function createJsonLogger(): Logger {
  return {
    payment(event) {
      jsonLine({ ts: event.timestamp, level: 'info', event: 'payment', ...event })
    },
    request(event) {
      jsonLine({ ts: event.timestamp, level: 'info', event: 'request', ...event })
    },
    challenge(event) {
      jsonLine({ ts: event.timestamp, level: 'info', event: 'challenge', ...event })
    },
    error(message, context) {
      jsonLine({ ts: new Date().toISOString(), level: 'error', event: 'error', message, ...context })
    },
    info(message) {
      jsonLine({ ts: new Date().toISOString(), level: 'info', event: 'info', message })
    },
    warn(message) {
      jsonLine({ ts: new Date().toISOString(), level: 'warn', event: 'warn', message })
    },
  }
}

export function createLogger(opts: LoggerOptions): Logger {
  if (opts.format === 'json') return createJsonLogger()
  return createPrettyLogger(opts.verbose)
}
```

Also add a stub for `createPrettyLogger` so it compiles:

```typescript
function createPrettyLogger(_verbose: boolean): Logger {
  return createNoopLogger() // placeholder — implemented in next step
}
```

- [ ] **Step 8: Run tests to verify JSON tests pass**

Run: `npx vitest run src/logger.test.ts`
Expected: PASS (all JSON tests + no-op tests)

- [ ] **Step 9: Add failing tests for pretty format logger**

Append to `src/logger.test.ts`:

```typescript
  describe('createLogger (pretty)', () => {
    let output: string[]
    let writeSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      output = []
      writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        output.push(typeof chunk === 'string' ? chunk : chunk.toString())
        return true
      })
    })

    afterEach(() => {
      writeSpy.mockRestore()
    })

    // Strip ANSI codes for assertion
    function strip(s: string): string {
      return s.replace(/\x1b\[[0-9;]*m/g, '')
    }

    it('formats payment with amount and hash', () => {
      const logger = createLogger({ format: 'pretty', verbose: false })
      logger.payment(samplePayment)
      expect(output).toHaveLength(1)
      const line = strip(output[0])
      expect(line).toContain('PAID')
      expect(line).toContain('21 sats')
    })

    it('formats request with endpoint, latency, and deduction', () => {
      const logger = createLogger({ format: 'pretty', verbose: false })
      logger.request(sampleRequest)
      const line = strip(output[0])
      expect(line).toContain('REQUEST')
      expect(line).toContain('/v1/chat/completions')
      expect(line).toContain('347ms')
      expect(line).toContain('1 sat')
      expect(line).toContain('79 remaining')
      expect(line).toContain('192.168.1.1')
    })

    it('formats challenge with endpoint, amount, and IP', () => {
      const logger = createLogger({ format: 'pretty', verbose: false })
      logger.challenge(sampleChallenge)
      const line = strip(output[0])
      expect(line).toContain('CHALLENGE')
      expect(line).toContain('/v1/chat/completions')
      expect(line).toContain('100 sats')
      expect(line).toContain('192.168.1.1')
    })

    it('formats error with message', () => {
      const logger = createLogger({ format: 'pretty', verbose: false })
      logger.error('upstream timeout', { endpoint: '/v1/chat/completions' })
      const line = strip(output[0])
      expect(line).toContain('ERROR')
      expect(line).toContain('upstream timeout')
    })

    it('formats info message', () => {
      const logger = createLogger({ format: 'pretty', verbose: false })
      logger.info('server started')
      const line = strip(output[0])
      expect(line).toContain('INFO')
      expect(line).toContain('server started')
    })

    it('includes extra fields in verbose mode', () => {
      const logger = createLogger({ format: 'pretty', verbose: true })
      logger.payment(samplePayment)
      const line = strip(output[0])
      expect(line).toContain('rail=l402')
    })

    it('omits extra fields in non-verbose mode', () => {
      const logger = createLogger({ format: 'pretty', verbose: false })
      logger.payment(samplePayment)
      const line = strip(output[0])
      expect(line).not.toContain('rail=')
    })
  })
```

- [ ] **Step 10: Implement the pretty formatter**

Replace the `createPrettyLogger` stub in `src/logger.ts`:

```typescript
// ANSI colour helpers
const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const DIM = '\x1b[2m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const RED = '\x1b[31m'
const WHITE = '\x1b[37m'

function truncHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-6)}` : hash
}

function createPrettyLogger(verbose: boolean): Logger {
  function write(line: string): void {
    process.stderr.write(line + '\n')
  }

  return {
    payment(event) {
      let line = `${GREEN}⚡ PAID      ${event.amountSats} sats (hash=${truncHash(event.paymentHash)})${RESET}`
      if (verbose) {
        const extras: string[] = []
        if (event.rail) extras.push(`rail=${event.rail}`)
        if (event.currency && event.currency !== 'sat') extras.push(`currency=${event.currency}`)
        if (extras.length > 0) line += ` ${DIM}${extras.join(' ')}${RESET}`
      }
      write(line)
    },

    request(event) {
      const satLabel = event.satsDeducted === 1 ? '1 sat' : `${event.satsDeducted} sats`
      let line = `${DIM}→ REQUEST   ${event.endpoint} ${event.latencyMs}ms ${satLabel} deducted (${event.remainingBalance} remaining) from ${event.clientIp}${RESET}`
      if (verbose) {
        const extras: string[] = [`authenticated=${event.authenticated}`]
        if (extras.length > 0) line += ` ${extras.join(' ')}`
      }
      write(line)
    },

    challenge(event) {
      write(`${CYAN}🔒 CHALLENGE ${event.endpoint} → 402 sent to ${event.clientIp} (${event.amountSats} sats)${RESET}`)
    },

    error(message, context) {
      let line = `${RED}⚠ ERROR     ${message}${RESET}`
      if (context) {
        const extras = Object.entries(context).map(([k, v]) => `${k}=${v}`).join(' ')
        line += ` ${DIM}${extras}${RESET}`
      }
      write(line)
    },

    info(message) {
      write(`${WHITE}ℹ INFO      ${message}${RESET}`)
    },

    warn(message) {
      write(`${YELLOW}⚠ WARN      ${message}${RESET}`)
    },
  }
}
```

- [ ] **Step 11: Run all logger tests**

Run: `npx vitest run src/logger.test.ts`
Expected: PASS (all tests)

- [ ] **Step 12: Commit**

```bash
git add src/logger.ts src/logger.test.ts
git commit -m "feat: add logger module with pretty and JSON formatters"
```

---

## Chunk 2: Configuration and wiring

### Task 2: Add logger config fields

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Add `verbose`, `logFormat`, and `logger` to `TokenTollConfig`**

In `src/config.ts`, add these fields to the `TokenTollConfig` interface (after `defaultPriceUsd?: number`, line 50):

```typescript
  verbose: boolean
  logFormat: 'pretty' | 'json'
  logger?: Logger
```

Also add the import at the top of `src/config.ts`:

```typescript
import type { Logger } from './logger.js'
```

- [ ] **Step 2: Add `--verbose` and `--log-format` to `CliArgs`**

Add to the `CliArgs` interface:

```typescript
  verbose?: boolean
  logFormat?: string
```

- [ ] **Step 3: Add `verbose` and `logFormat` to `FileConfig`**

Add to the `FileConfig` interface:

```typescript
  verbose?: boolean
  logFormat?: string
```

- [ ] **Step 4: Parse the new fields in `loadConfig`**

Add before the final `return` statement (around line 278):

```typescript
  // Logging
  const verbose = args.verbose
    ?? (env.TOKEN_TOLL_VERBOSE !== undefined ? env.TOKEN_TOLL_VERBOSE === 'true' : undefined)
    ?? file.verbose
    ?? false
  const logFormatRaw = args.logFormat ?? env.TOKEN_TOLL_LOG_FORMAT ?? file.logFormat ?? 'pretty'
  if (logFormatRaw !== 'pretty' && logFormatRaw !== 'json') {
    throw new Error(`Invalid log format: ${logFormatRaw} (must be 'pretty' or 'json')`)
  }
  const logFormat = logFormatRaw as 'pretty' | 'json'
```

Add `verbose` and `logFormat` to the return object.

- [ ] **Step 5: Add config tests**

Add tests to `src/config.test.ts` for the new fields:

```typescript
describe('logging config', () => {
  it('defaults verbose to false', () => {
    const config = loadConfig({ upstream: 'http://localhost:1234' })
    expect(config.verbose).toBe(false)
  })

  it('defaults logFormat to pretty', () => {
    const config = loadConfig({ upstream: 'http://localhost:1234' })
    expect(config.logFormat).toBe('pretty')
  })

  it('accepts verbose from CLI args', () => {
    const config = loadConfig({ upstream: 'http://localhost:1234', verbose: true })
    expect(config.verbose).toBe(true)
  })

  it('accepts logFormat from env', () => {
    const config = loadConfig({ upstream: 'http://localhost:1234' }, { TOKEN_TOLL_LOG_FORMAT: 'json' })
    expect(config.logFormat).toBe('json')
  })

  it('rejects invalid logFormat', () => {
    expect(() => loadConfig({ upstream: 'http://localhost:1234' }, { TOKEN_TOLL_LOG_FORMAT: 'xml' }))
      .toThrow('Invalid log format')
  })
})
```

- [ ] **Step 6: Run config tests**

Run: `npx vitest run src/config.test.ts`
Expected: PASS (all existing + 5 new tests)

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: add verbose and logFormat config fields"
```

### Task 3: Wire toll-booth events to logger in server.ts

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Import logger and use it in `createTokenTollServer`**

Add import at the top of `src/server.ts`:

```typescript
import { createNoopLogger, type Logger } from './logger.js'
```

At the start of `createTokenTollServer`, resolve the logger:

```typescript
const logger = config.logger ?? createNoopLogger()
```

- [ ] **Step 2: Wire event callbacks to `createTollBooth`**

Change the `createTollBooth` call (lines 65-78) to include the event callbacks:

```typescript
  const engine = createTollBooth({
    rootKey: config.rootKey,
    storage,
    upstream: config.upstream,
    backend: config.backend,
    pricing: {
      '/v1/chat/completions': pricingEntry,
      '/v1/completions': pricingEntry,
      '/v1/embeddings': pricingEntry,
    },
    defaultInvoiceAmount: config.tiers[0]?.amountSats ?? 1000,
    freeTier: config.freeTier.requestsPerDay > 0 ? { requestsPerDay: config.freeTier.requestsPerDay } : undefined,
    ...(rails.length > 0 && { rails }),
    onPayment: (e) => logger.payment(e),
    onRequest: (e) => logger.request(e),
    onChallenge: (e) => logger.challenge(e),
  })
```

- [ ] **Step 3: Pass logger to proxy handler**

Change the `createProxyHandler` call (lines 154-161) to include logger:

```typescript
  const proxyHandler = createProxyHandler({
    upstream: config.upstream,
    pricing: config.pricing,
    capacity,
    reconcile: (paymentHash, actualCost) => engine.reconcile(paymentHash, actualCost),
    maxBodySize: config.maxBodySize,
    flatPricing: config.flatPricing,
    logger,
  })
```

- [ ] **Step 4: Continue to Task 4** (commit deferred — `ProxyDeps` doesn't have `logger` yet)

### Task 4: Add logger to proxy handler

**Files:**
- Modify: `src/proxy/handler.ts`

- [ ] **Step 1: Add `logger` to `ProxyDeps` interface**

Add import at the top:

```typescript
import type { Logger } from '../logger.js'
```

Add to the `ProxyDeps` interface (after `upstreamTimeout?: number`):

```typescript
  /** Logger instance — if omitted, errors are silent. */
  logger?: Logger
```

- [ ] **Step 2: Replace `console.error` with `logger.error()`**

Add a `start` timestamp inside the `handleProxy` function, after the capacity check block's closing brace (line 42) and before `let streamingResponse = false` (line 44):

```typescript
    const start = Date.now()
```

Replace line 121:

```typescript
        console.error('[token-toll] upstream error:', err instanceof Error ? err.message : err)
```

with:

```typescript
        deps.logger?.error('upstream error', {
          endpoint: new URL(req.url).pathname,
          method: req.method,
          latencyMs: Date.now() - start,
          reason: err instanceof Error ? err.message : String(err),
        })
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — no errors

- [ ] **Step 4: Run existing proxy handler tests**

Run: `npx vitest run src/proxy/handler.test.ts`
Expected: PASS — existing tests unaffected (logger is optional)

- [ ] **Step 5: Add test for logger.error on upstream failure**

In `src/proxy/handler.test.ts`, add a test that verifies the logger is called on upstream error:

```typescript
it('calls logger.error on upstream failure', async () => {
  const errorSpy = vi.fn()
  const handler = createProxyHandler({
    ...deps,
    upstream: 'http://localhost:1', // unreachable
    logger: { error: errorSpy, info: vi.fn(), warn: vi.fn(), payment: vi.fn(), request: vi.fn(), challenge: vi.fn() },
  })
  const req = new Request('http://localhost/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'test', messages: [] }),
  })
  const res = await handler(req, 'abc123')
  expect(res.status).toBe(502)
  expect(errorSpy).toHaveBeenCalledOnce()
  expect(errorSpy.mock.calls[0][0]).toBe('upstream error')
})
```

Note: adapt the `deps` setup to match the existing test patterns in this file. The key assertion is that `errorSpy` is called with `'upstream error'` as the first argument.

- [ ] **Step 6: Run proxy handler tests again**

Run: `npx vitest run src/proxy/handler.test.ts`
Expected: PASS — all tests including the new one

- [ ] **Step 7: Commit (includes server.ts from Task 3)**

```bash
git add src/server.ts src/proxy/handler.ts src/proxy/handler.test.ts
git commit -m "feat: wire logger to server and proxy handler"
```

---

## Chunk 3: CLI integration

### Task 5: Create logger in CLI and replace console.log banner

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add `--verbose` and `--log-format` to parseArgs**

In `src/cli.ts`, add two new cases to the `switch` in `parseArgs` (before the `default:` case, around line 32):

```typescript
      case '--verbose': args.verbose = true; break
      case '--log-format': args.logFormat = argv[++i]; break
```

- [ ] **Step 2: Add to help text**

In the `printHelp` function, add under the "Other:" section (before `-h, --help`):

```
    --verbose                  Show extra fields in log output
    --log-format <format>      pretty | json (default: pretty)
```

- [ ] **Step 3: Create logger and pass to server**

Add import at top of `src/cli.ts`:

```typescript
import { createLogger } from './logger.js'
```

After `const config = loadConfig(...)` (line 141), create the logger:

```typescript
  const logger = createLogger({ format: config.logFormat, verbose: config.verbose })
```

Change the `createTokenTollServer` call (line 154) to include the logger:

```typescript
  const { app } = createTokenTollServer({ ...config, models, backend, logger })
```

- [ ] **Step 4: Replace startup banner `console.log` calls with `logger.info()`**

Replace the `console.log` startup banner block (lines 177-192) with individual `logger.info()` calls:

```typescript
    logger.info(`token-toll v${version}`)
    logger.info(`Upstream:   ${config.upstream}${ollamaAutoDetected ? ' (auto-detected)' : ''}`)
    logger.info(`Models:     ${models.length > 0 ? models.join(', ') : '(none detected)'}`)
    logger.info(`Lightning:  ${lightningLabel}`)
    logger.info(`Auth:       ${authLabel}`)
    logger.info(`Price:      ${priceLabel}`)
    logger.info(`Storage:    ${config.storage}${config.storage === 'memory' ? ' (ephemeral)' : ''}`)
    logger.info(`Local:      http://localhost:${config.port}`)
    if (config.rootKeyGenerated) {
      logger.warn('Using auto-generated root key (not persisted across restarts)')
      logger.warn('Set ROOT_KEY env var for production use')
    }
    logger.info('/.well-known/l402  |  /llms.txt  |  /health')
```

Replace the tunnel output (lines 194-204):

```typescript
    if (config.tunnel) {
      tunnelResult = await startTunnel(config.port)
      if (tunnelResult.url) {
        logger.info(`Public:     ${tunnelResult.url}`)
      } else if (tunnelResult.error) {
        logger.warn(`Tunnel:     ${tunnelResult.error}`)
      }
    } else {
      logger.info('Tunnel:     disabled')
    }
```

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: PASS — all tests pass (existing tests don't create a logger, so they get the no-op)

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts
git commit -m "feat: create logger in CLI, replace console.log startup banner"
```

---

## Chunk 4: Final verification

### Task 6: Typecheck and full test suite

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Verify no stray console.log/error/warn in src/**

Run: `grep -rn 'console\.\(log\|error\|warn\)' src/ --include='*.ts'`

Expected: Only hits in `cli.ts` for pre-logger errors (lines 33, 52, 128-129) — these fire before the logger exists and are intentionally kept as bare `console.*`.

- [ ] **Step 4: Commit if anything was missed**

```bash
git status
# If clean, nothing to do. Otherwise:
git add -A && git commit -m "chore: observability cleanup"
```
