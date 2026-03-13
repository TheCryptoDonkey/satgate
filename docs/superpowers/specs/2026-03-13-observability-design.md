# Observability — Design Spec

**Date:** 2026-03-13
**Status:** Draft

---

## Overview

Add structured logging to token-toll so operators can see what's happening: payments received, requests served, challenges issued, errors encountered. Coloured human-readable output by default, with a JSON mode for machine consumption. Zero new dependencies.

## Audience

Self-hosters running token-toll on a VPS who need terminal-level visibility into their inference proxy. Production log aggregation is a future concern — for now, the terminal is the dashboard.

## Architecture

```
cli.ts
  │  creates Logger(format, verbose)
  │  passes to createTokenTollServer(config)
  ▼
server.ts
  │  wires toll-booth event callbacks → logger
  │  passes logger to proxy handler
  ▼
logger.ts
  │  formats and emits events
  │  two modes: pretty (coloured) / json
  ▼
stdout
```

The logger is created once in `cli.ts` and passed to `createTokenTollServer()` via a `logger?: Logger` field on `TokenTollConfig`. No global state, no singletons. When `logger` is omitted (programmatic use, tests), `createTokenTollServer` creates a no-op logger internally.

## Logger module (`src/logger.ts`)

### Interface

```typescript
interface Logger {
  challenge(event: ChallengeEvent): void
  payment(event: PaymentEvent): void
  request(event: RequestEvent): void
  error(message: string, context?: Record<string, unknown>): void
  info(message: string): void
  warn(message: string): void
}
```

`ChallengeEvent`, `PaymentEvent`, and `RequestEvent` are imported from `@thecryptodonkey/toll-booth` — they already carry all the data we need.

### Factory

```typescript
function createLogger(opts: { format: 'pretty' | 'json'; verbose: boolean }): Logger
function createNoopLogger(): Logger
```

### Pretty format (default)

One-liner per event with emoji prefix and ANSI colours:

```
⚡ PAID      21 sats (hash=ab12…cd34)
→ REQUEST   POST /v1/chat/completions 347ms 1 sat deducted (79 remaining) from 192.168.1.1
🔒 CHALLENGE POST /v1/chat/completions → 402 sent to 192.168.1.1 (100 sats)
⚠ ERROR     upstream timeout POST /v1/chat/completions (5003ms)
ℹ INFO      token-toll v0.1.0 listening on http://localhost:3456
```

Note: `PaymentEvent` does not carry `clientIp` or `remainingBalance` — those fields are only on `RequestEvent` and `ChallengeEvent`. Payment lines show amount, hash, and rail only.

Colours:
- Payment: green
- Request (2xx): dim/grey
- Request (4xx/5xx): yellow
- Challenge: cyan
- Error: red
- Info/Warn: white/yellow

### Verbose mode (`--verbose`)

Appends extra fields to each line:

```
→ REQUEST   POST /v1/chat/completions 347ms 1 sat deducted (79 remaining) from 192.168.1.1 authenticated=true
⚡ PAID      21 sats hash=ab12…cd34 rail=l402
```

### JSON format (`--log-format json`)

One JSON object per line, all fields included regardless of verbose flag:

```json
{"ts":"2026-03-13T12:00:00.000Z","level":"info","event":"payment","amountSats":21,"paymentHash":"ab12...","rail":"l402"}
{"ts":"2026-03-13T12:00:00.000Z","level":"info","event":"request","endpoint":"/v1/chat/completions","satsDeducted":1,"remainingBalance":79,"latencyMs":347,"clientIp":"192.168.1.1"}
```

### No-op logger

When `logger` is not provided in config (programmatic use, existing tests), `createNoopLogger()` returns an object where every method is a no-op. This keeps test output clean.

## Wiring toll-booth events (`src/server.ts`)

The three event callbacks are passed to `createTollBooth()`:

```typescript
const engine = createTollBooth({
  // ...existing config...
  onChallenge: (e) => logger.challenge(e),
  onPayment: (e) => logger.payment(e),
  onRequest: (e) => logger.request(e),
})
```

These callbacks already exist in toll-booth's API and carry:

- **ChallengeEvent**: `timestamp`, `endpoint`, `amountSats`, `clientIp`
- **PaymentEvent**: `timestamp`, `paymentHash`, `amountSats`, `currency?`, `rail?`
- **RequestEvent**: `timestamp`, `endpoint`, `satsDeducted`, `remainingBalance`, `latencyMs`, `authenticated`, `clientIp`, `currency?`

No new data collection is needed — we're just consuming what toll-booth already provides.

## Error and proxy logging (`src/proxy/handler.ts`)

Replace the existing bare `console.error('[token-toll] upstream error:', err.message)` with `logger.error()` calls that include structured context:

```typescript
logger.error('upstream error', {
  endpoint: req.path,
  method: req.method,
  latencyMs: Date.now() - start,
  reason: err.message,
})
```

This requires adding a `start = Date.now()` timestamp at the beginning of the proxy handler. The logger reference is passed into `createProxyHandler()` by adding `logger?: Logger` to the `ProxyDeps` interface and passing it from `server.ts`.

## Startup logging (`src/cli.ts`)

Replace the current `console.log` startup banner with `logger.info()` calls. The banner content stays the same — just routed through the logger so it respects format mode and can be suppressed in tests.

**Pre-logger errors:** A few `console.error`/`console.warn` calls in `cli.ts` fire before the logger is created (unknown CLI flags, missing config file, upstream not found). These remain as bare `console.error`/`console.warn` — they're fatal or near-fatal startup errors where the logger doesn't exist yet.

**Output destination:** All logger output goes to `process.stderr` so that `stdout` remains clean for potential structured output or piping. The startup banner also goes to stderr.

## Configuration (`src/config.ts`)

Three new fields on `TokenTollConfig`:

```typescript
verbose: boolean                // default: false
logFormat: 'pretty' | 'json'   // default: 'pretty'
logger?: Logger                 // optional — if omitted, createTokenTollServer uses createNoopLogger()
```

`cli.ts` creates the logger from `verbose` + `logFormat` and sets it on config before calling `createTokenTollServer()`. Programmatic callers can either pass their own logger or omit it for silence.

### CLI flags

| Flag | Default |
|------|---------|
| `--verbose` | `false` |
| `--log-format <pretty\|json>` | `pretty` |

### Environment variables

| Variable | Default |
|----------|---------|
| `TOKEN_TOLL_VERBOSE` | `false` |
| `TOKEN_TOLL_LOG_FORMAT` | `pretty` |

### Config file (YAML)

```yaml
verbose: true
logFormat: json
```

Precedence: CLI flags > env vars > config file > defaults (matching existing pattern).

## File changes

| File | Change |
|------|--------|
| `src/logger.ts` | **New** — createLogger, createNoopLogger, pretty/JSON formatters |
| `src/config.ts` | Add `verbose`, `logFormat` fields; parse new flags and env vars |
| `src/server.ts` | Accept logger via config, wire toll-booth event callbacks, pass to proxy handler |
| `src/proxy/handler.ts` | Replace `console.error` with `logger.error()`, add upstream latency timing |
| `src/cli.ts` | Create logger from config, replace `console.log` startup banner |

## Testing

### Unit tests (`src/logger.test.ts`)

- Pretty formatter produces expected coloured output for each event type
- JSON formatter produces valid JSON with expected fields
- Verbose mode includes extra fields
- No-op logger methods don't throw

### Existing tests

Unaffected — `createTokenTollServer` without a logger in config uses the no-op logger. No test output changes.

## Out of scope

- Log file output / rotation (use shell redirection: `token-toll > app.log 2>&1`)
- Metrics endpoints (Prometheus, OpenTelemetry)
- Request IDs / distributed tracing
- Dashboards / alerting
- Log level filtering (info/debug/warn — all events are logged, verbose controls detail level)
