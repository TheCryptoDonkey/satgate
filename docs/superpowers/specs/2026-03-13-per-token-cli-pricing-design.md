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
| `--token-price <sats>` | `TOKEN_TOLL_TOKEN_PRICE` | Default rate in sats per 1k tokens |
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

### Mutual exclusion

`--price` (flat) and `--token-price` (per-token) are mutually exclusive. If both are provided, `loadConfig()` throws:

```
Cannot use --price (flat) and --token-price (per-token) together
```

This check applies across all sources: CLI, env vars, and config file. Specifically, if `flatPrice` is set (from `args.price` or `file.price`) and `tokenPrice` is also set (from `args.tokenPrice` or `env.TOKEN_TOLL_TOKEN_PRICE`), that's an error.

### Interaction with config file

- CLI `--token-price` / `--model-price` override config file `pricing.default` / `pricing.models`
- If a config file has a `pricing` block AND CLI has `--token-price`, CLI wins (standard precedence)
- If a config file has a `pricing` block and no CLI pricing flags, config file pricing is used as today

## Config flow

In `loadConfig()`, after gathering all sources:

1. Parse `tokenPrice` from CLI args or env var
2. Parse `modelPrice` entries from CLI args or env var
3. If `tokenPrice` or `modelPrice` is set:
   - Set `pricing.default` to `tokenPrice ?? 1`
   - Merge `modelPrice` entries into `pricing.models`
   - Set `flatPricing = false`
4. Mutual exclusion: if both `flatPrice` and `tokenPrice` are defined, throw

## CliArgs changes

```typescript
tokenPrice?: number        // --token-price <sats>
modelPrice?: string[]      // --model-price <model:sats> (repeatable)
```

## File changes

| File | Change |
|------|--------|
| `src/config.ts` | Add `tokenPrice?`, `modelPrice?` to `CliArgs`; parse in `loadConfig()`; mutual exclusion |
| `src/cli.ts` | Add `--token-price` and `--model-price` to `parseArgs()` and help text |
| `src/config.test.ts` | Tests for new flags, mutual exclusion, env vars, model price parsing |

No changes to `server.ts`, `proxy/handler.ts`, `proxy/pricing.ts`, or any other file. The per-token pricing engine already works — we're just populating `ModelPricing` from a new source.

## Testing

Unit tests in `src/config.test.ts`:

- `--token-price` sets `flatPricing = false` and `pricing.default`
- `--model-price` populates `pricing.models`
- `--model-price` without `--token-price` uses default of 1
- `--price` and `--token-price` together throws
- Env var `TOKEN_TOLL_TOKEN_PRICE` works
- Env var `TOKEN_TOLL_MODEL_PRICE` parses comma-separated entries
- Invalid `--model-price` format (missing colon, non-numeric rate) throws
- Negative or zero rates throw

## Out of scope

- Changes to discovery endpoints (they already use `config.pricing`)
- Changes to reconciliation logic
- README updates (deferred to npm publish milestone)
