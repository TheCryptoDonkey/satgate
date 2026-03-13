# Per-Token CLI Pricing — Design Spec

**Date:** 2026-03-13
**Status:** Draft

---

## Overview

Expose per-token pricing from the CLI without requiring a config file. Two new flags — `--token-price` and `--model-price` — populate the existing `ModelPricing` config that the per-token pricing engine already uses.

## Problem

`--price` sets a flat per-request fee. Per-token pricing (the main feature) is only accessible via YAML/JSON config file. CLI-only users can't use the headline feature.

## New CLI flags

| Flag | Env var | Description |
|------|---------|-------------|
| `--token-price <sats>` | `TOKEN_TOLL_TOKEN_PRICE` | Default rate in sats per 1k tokens (integer, > 0) |
| `--model-price <model:sats>` | `TOKEN_TOLL_MODEL_PRICE` | Per-model rate, repeatable. Env var is comma-separated (`llama3:2,deepseek-r1:5`) |

### Examples

```bash
# Flat pricing (existing, unchanged)
token-toll --price 5

# Per-token, single rate for all models
token-toll --token-price 1

# Per-token with model-specific rates
token-toll --token-price 1 --model-price llama3:2 --model-price deepseek-r1:5

# Model-specific only (default rate falls back to 1)
token-toll --model-price deepseek-r1:5
```

### Help text

```
  Pricing:
    --price <sats>             Sats per request (flat pricing)
    --token-price <sats>       Sats per 1k tokens (per-token pricing)
    --model-price <model:sats> Per-model token price (repeatable)
```

### Mutual exclusion

`--price` (flat) and `--token-price`/`--model-price` (per-token) are mutually exclusive. If both are provided, `loadConfig()` throws:

```
Cannot use --price (flat) and --token-price (per-token) together
```

This check applies across all sources: CLI, env vars, and config file. The check is performed early in `loadConfig()`, right after resolving `flatPrice` and `tokenPrice` from all sources, before the pricing object is built.

### Interaction with config file

- CLI `--token-price` overrides config file `pricing.default`
- CLI `--model-price` entries **merge** with config file `pricing.models` (CLI entries win on conflict)
- If a config file has a `pricing` block and no CLI pricing flags, config file pricing is used as today

### Relationship with existing `DEFAULT_PRICE` env var

The existing `DEFAULT_PRICE` env var sets `pricing.default` but does NOT switch to per-token mode on its own (it's used regardless of mode for estimatedCostSats calculation). `TOKEN_TOLL_TOKEN_PRICE` explicitly enables per-token mode. When both are set, `TOKEN_TOLL_TOKEN_PRICE` takes precedence for `pricing.default`.

## Config flow

In `loadConfig()`, the pricing resolution changes to:

1. Resolve `tokenPrice` from `args.tokenPrice` or `parseInt(env.TOKEN_TOLL_TOKEN_PRICE)`
2. Resolve `modelPriceEntries` from `args.modelPrice` or `env.TOKEN_TOLL_MODEL_PRICE?.split(',')` — merge both (CLI wins)
3. **Mutual exclusion check** (before building pricing object): if `flatPrice` is defined AND (`tokenPrice` is defined OR `modelPriceEntries` is non-empty), throw
4. Determine per-token mode: `hasCliTokenPricing = tokenPrice !== undefined || (modelPriceEntries && modelPriceEntries.length > 0)`
5. Update `hasPricingConfig` to include CLI per-token flags: `hasPricingConfig = file.pricing !== undefined || hasCliTokenPricing`
6. If `hasCliTokenPricing`:
   - Override `pricingDefault` with `tokenPrice` (if set)
   - Parse each model-price entry (split on first `:`, validate rate is a finite positive integer)
   - Merge parsed entries into `pricing.models` (CLI entries override file entries)
7. Recalculate `estimatedCostSats` using the final `pricingDefault` (not the stale file-only value)

### Model-price parsing

Split on the **first** `:` only (to allow model IDs containing colons, e.g. `qwen3:0.6b`). Validate:
- Right-hand side is a finite positive integer (`parseInt`, then check `> 0` and `isFinite`)
- Throw: `Invalid --model-price value: "<raw>" (expected <model>:<sats>)`

### Rates are positive integers

All rates (both `--token-price` and `--model-price` rates) must be positive integers (`> 0`). This matches the existing `pricing.default` semantics. Zero is not valid for per-token pricing (it would mean free inference with no metering).

## CliArgs changes

```typescript
tokenPrice?: number        // --token-price <sats>
modelPrice?: string[]      // --model-price <model:sats> (repeatable, accumulated via push)
```

### parseArgs accumulation

`--model-price` is the first repeatable flag in `parseArgs()`. The switch case must accumulate:

```typescript
case '--model-price':
  args.modelPrice = [...(args.modelPrice ?? []), argv[++i]]
  break
```

### Env var parsing

`TOKEN_TOLL_MODEL_PRICE` is parsed in `loadConfig()` (not `parseArgs()`), split on `,`, yielding `string[]`. These are merged with `args.modelPrice` — CLI entries take precedence on conflict (same model name).

## File changes

| File | Change |
|------|--------|
| `src/config.ts` | Add `tokenPrice?`, `modelPrice?` to `CliArgs`; parse in `loadConfig()`; mutual exclusion; estimatedCostSats fix |
| `src/cli.ts` | Add `--token-price` and `--model-price` to `parseArgs()` and help text |
| `src/config.test.ts` | Tests for new flags, mutual exclusion, env vars, model price parsing |

No changes to `server.ts`, `proxy/handler.ts`, `proxy/pricing.ts`, or any other file. The per-token pricing engine already works — we're just populating `ModelPricing` from a new source.

## Testing

Unit tests in `src/config.test.ts`:

- `--token-price` sets `flatPricing = false` and `pricing.default`
- `--model-price` populates `pricing.models`
- `--model-price` without `--token-price` uses default of 1 and sets `flatPricing = false`
- `--price` and `--token-price` together throws
- `--price` and `--model-price` together throws
- Env var `TOKEN_TOLL_TOKEN_PRICE` works
- Env var `TOKEN_TOLL_MODEL_PRICE` parses comma-separated entries
- CLI `--model-price` merges with config file `pricing.models`
- Invalid `--model-price` format (missing colon, non-numeric rate) throws
- Negative or zero `--token-price` throws
- `estimatedCostSats` reflects CLI `tokenPrice` when set

## Out of scope

- Changes to discovery endpoints (they already use `config.pricing`)
- Changes to reconciliation logic in proxy
- README updates (deferred to npm publish milestone)
