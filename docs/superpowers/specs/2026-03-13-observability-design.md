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

The logger is created once in `cli.ts` and threaded through config. No global state, no singletons. When no logger is provided (programmatic use, tests), a silent no-op logger is used.

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
⚡ PAID      21 sats from 192.168.1.1 → credit 79 sats remaining
→ REQUEST   POST /v1/chat/completions 200 347ms 156 tokens (1 sat deducted)
🔒 CHALLENGE POST /v1/chat/completions → 402 sent to 192.168.1.1 (100 sats)
⚠ ERROR     upstream timeout POST /v1/chat/completions (5003ms)
ℹ INFO      token-toll v0.1.0 listening on http://localhost:3456
```

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
→ REQUEST   POST /v1/chat/completions 200 347ms 156 tokens (1 sat deducted) model=llama3 hash=ab12…cd34
⚡ PAID      21 sats from 192.168.1.1 → credit 79 sats remaining hash=ab12…cd34 rail=l402
```

### JSON format (`--log-format json`)

One JSON object per line, all fields included regardless of verbose flag:

```json
{"ts":"2026-03-13T12:00:00.000Z","level":"info","event":"payment","amount":21,"ip":"192.168.1.1","remaining":79,"paymentHash":"ab12...","rail":"l402"}
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

- **ChallengeEvent**: endpoint, amount, clientIp
- **PaymentEvent**: amount, paymentHash, currency, rail
- **RequestEvent**: endpoint, costDeducted, remainingBalance, latencyMs, clientIp

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

This requires adding a `start = Date.now()` timestamp at the beginning of the proxy handler. The logger reference is passed into `createProxyHandler()` via its options.

## Startup logging (`src/cli.ts`)

Replace the current `console.log` startup banner with `logger.info()` calls. The banner content stays the same — just routed through the logger so it respects format mode and can be suppressed in tests.

## Configuration (`src/config.ts`)

Two new fields on `TokenTollConfig`:

```typescript
verbose: boolean     // default: false
logFormat: 'pretty' | 'json'  // default: 'pretty'
```

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
