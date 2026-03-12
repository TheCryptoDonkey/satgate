# token-toll Quick-Start Design

> "npx token-toll and earn sats in 30 seconds"

**Date:** 2026-03-12
**Status:** Draft

---

## Overview

token-toll is a CLI that turns any OpenAI-compatible inference endpoint into a Lightning-paid (or access-controlled) API. The quick-start targets four distinct user paths — from zero-config local dev to earning real sats — behind a single `npx token-toll` command with progressive flag disclosure.

## Design Decisions

### Settled

- **Single command, no subcommands** — `npx token-toll` is the only entry point
- **Three auth modes:** open (free/dev), lightning (pay-per-request), allowlist (community/known group)
- **Auth mode is inferred** from flags unless explicitly set with `--auth`
- **Cloudflare Tunnel** auto-spawned if `cloudflared` is on PATH; graceful degradation if not
- **Ollama auto-detected** on `:11434` when `--upstream` omitted
- **Per-backend URL defaults** eliminate `--lightning-url` in the common case
- **Flat per-request pricing** via `--price` flag (default: 1 sat); per-model/per-token pricing available via config file
- **toll-booth stays a payment library** — auth mode routing lives in token-toll
- **npm publish** requires only `files` field, `prepublishOnly` script, and `js-yaml` dependency

### Out of Scope for v1

- Per-identity usage tracking in allowlist mode
- Mixed mode (allowlisted users free, strangers pay)
- Per-identity rate limits
- Automated SSH tunnel management
- Backend auto-detection (sniffing URL to determine phoenixd vs lnbits)
- Alby/NWC in CLI (toll-booth supports it but it's niche)

---

## User Paths

| Tier | Command | What Happens |
|------|---------|-------------|
| **Free / dev** | `npx token-toll` | Auto-detects Ollama, open access, no payments. Local proxy with discovery endpoints. |
| **phoenixd** | `npx token-toll --lightning phoenixd --lightning-key pw` | SSH tunnel to VPS assumed. Earns real sats. |
| **LNbits** | `npx token-toll --lightning lnbits --lightning-key apikey` | Easiest "real sats" on-ramp. Defaults to legend.lnbits.com. |
| **LND / CLN** | `npx token-toll --lightning lnd --lightning-key macaroon` | For users with existing node infrastructure. |
| **Community** | `npx token-toll --auth allowlist --allowlist npub1abc,npub1def` | Known group, no payments, identity-checked access. |

---

## CLI Flags

```
Upstream:
  --upstream <url>           Upstream API URL (default: auto-detect Ollama on :11434)

Lightning:
  --lightning <backend>      phoenixd | lnbits | lnd | cln
  --lightning-url <url>      Backend URL (defaults per backend — see table below)
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
  --trust-proxy              Trust X-Forwarded-For
  -h, --help                 Show help
  -v, --version              Show version
```

### Per-Backend URL Defaults

| Backend | Default URL |
|---------|------------|
| phoenixd | `http://localhost:9740` |
| lnbits | `https://legend.lnbits.com` |
| lnd | `https://localhost:8080` |
| cln | `http://localhost:3010` |

### Auth Mode Inference

| Flags Present | Inferred Auth Mode |
|--------------|-------------------|
| No `--lightning`, no `--auth` | `open` |
| `--lightning` present, no `--auth` | `lightning` |
| `--auth allowlist` | `allowlist` |
| `--auth open` (explicit) | `open` (even with `--lightning` — useful for dev/testing with Lightning backend connected but payments disabled) |
| `--auth lightning` without `--lightning` | **Error** — exit with message: "auth mode 'lightning' requires --lightning <backend>" |

### Config File Keys

New fields in `token-toll.yaml` / `token-toll.json`, following the existing flat naming convention:

```yaml
# Existing fields (unchanged)
upstream: http://localhost:11434
port: 3000
storage: sqlite
dbPath: ./token-toll.db

# New fields
lightning: phoenixd              # backend type
lightningUrl: http://localhost:9740
lightningKey: mypassword

auth: lightning                  # open | lightning | allowlist
allowlist:                       # list of npubs or shared secrets
  - npub1abc...
  - npub1def...
  - my-shared-secret

price: 1                        # flat sats/request (triggers flat pricing mode)

tunnel: true                     # set false to disable (equivalent to --no-tunnel)

# Existing advanced pricing (triggers per-token mode, mutually exclusive with top-level 'price')
pricing:
  default: 1
  models:
    llama3: 1
    deepseek-r1: 5
```

Environment variables for new fields: `LIGHTNING_BACKEND`, `LIGHTNING_URL`, `LIGHTNING_KEY`, `AUTH_MODE`, `TUNNEL`.

---

## Architecture

### Request Flow

```
Request arrives
    |
    v
token-toll auth middleware (src/auth/middleware.ts)
    |
    +-- open mode --> pass through, no checks
    |
    +-- allowlist mode --> extract identity from request
    |     +-- found in allowlist --> pass through
    |     +-- not found --> 403 Forbidden
    |
    +-- lightning mode --> delegate to toll-booth
    |     +-- valid L402 credential --> pass through
    |     +-- free tier remaining --> pass through
    |     +-- no credential --> 402 Payment Required
    |
    v
proxy to upstream (existing handler)
```

### Allowlist Identity Extraction (v1)

Two identity types:

1. **Shared secret** — `Authorization: Bearer <secret>` header. Simplest, works with any HTTP client.
2. **Nostr pubkey** — `Authorization: Nostr <NIP-98 token>` header. Signed kind 27235 (NIP-98 HTTP Auth) event proves identity without sharing secrets. Requires `@noble/secp256k1` or `@noble/curves` for schnorr signature verification (lightweight, no native deps).

Detection: npub-prefixed entries in the allowlist use NIP-98 verification; all other entries are treated as shared secrets.

### Tunnel Layer

**On startup:**

1. Check if `cloudflared` is on PATH
2. If found: spawn `cloudflared tunnel --url http://localhost:<port>` as a child process
3. Parse tunnel URL from `cloudflared`'s stderr output
4. Print tunnel URL in startup banner
5. Kill child process on SIGINT/SIGTERM

**If not found:** print local URL + install hint (`brew install cloudflared`). Not an error.

**`--no-tunnel`:** skip entirely. Default behaviour (no flag) is tunnel **enabled** — `cloudflared` is spawned if found on PATH.

### Startup Banner

```
+-------------------------------------------------+
|  token-toll v0.1.0                              |
+-------------------------------------------------+
|  Upstream:   Ollama (auto-detected)             |
|  Models:     llama3, mistral, deepseek-r1       |
|  Lightning:  phoenixd (localhost:9740)           |
|  Auth:       lightning (pay-per-request)         |
|  Price:      1 sat/request                      |
|  Local:      http://localhost:3000              |
|  Public:     https://abc-xyz.trycloudflare.com  |
+-------------------------------------------------+
|  /.well-known/l402  |  /llms.txt  |  /health    |
+-------------------------------------------------+
```

Variants:
- No Lightning: `Lightning: none (free mode)` and `Auth: open`
- No tunnel: `Tunnel: disabled` or `Tunnel: cloudflared not found — brew install cloudflared`
- Allowlist: `Auth: allowlist (3 identities)`

### Ollama Auto-Detection

When `--upstream` is omitted:

1. Probe `http://localhost:11434/v1/models` (Ollama's OpenAI-compatible endpoint)
2. If responds: use `http://localhost:11434` as upstream, print "Ollama (auto-detected)"
3. If not: print error and exit — upstream is required

Using `/v1/models` (not `/api/tags`) keeps the probe consistent with the existing model-fetch logic in `cli.ts`. Same endpoint, same response shape, one code path.

No other auto-detection for v1.

### Pricing Modes

Two pricing modes, selected by how the user configures pricing:

**CLI flag (`--price N`):** Flat per-request pricing. Sets a fixed hold amount of N sats per request. The existing token counting and `engine.reconcile()` call are **skipped** — the hold amount is the final charge. This is the quick-start path: simple, predictable, no metering surprises.

**Config file (pricing.models + pricing.default):** Per-model, per-1k-token pricing. The existing token counting and reconciliation machinery is used. The `estimatedCostSats` hold is charged upfront, then `engine.reconcile()` adjusts based on actual token usage. This is the advanced path for operators who want fine-grained pricing.

**Selection logic:** If `--price` is passed (or `price` is set in config as a top-level number), use flat mode. If `pricing.models` exists in the config file, use per-token mode. If both are present, `--price` (CLI) wins and flat mode is used. The existing `pricing.default` field in config maps to per-token mode's default rate, not flat mode.

**Implementation:** The proxy handler checks a `flatPricing: boolean` flag on config. When true, it sets the hold amount to `config.price`, proxies the request, and does not call `engine.reconcile()`. When false, the current behaviour (token counting + reconciliation) is preserved unchanged.

---

## Lightning Backend Wiring

token-toll instantiates the appropriate toll-booth backend factory based on `--lightning`:

```
--lightning phoenixd  -->  phoenixdBackend({ url, password })
--lightning lnbits    -->  lnbitsBackend({ url, apiKey })
--lightning lnd       -->  lndBackend({ url, macaroon })
--lightning cln       -->  clnBackend({ url, rune })
```

**LND macaroon handling:** `--lightning-key` for LND accepts either a hex-encoded macaroon string or a file path. Detection: if the value contains only hex characters (`/^[0-9a-fA-F]+$/`), treat as hex string and pass as `macaroon`. Otherwise, treat as a file path and pass as `macaroonPath`. This covers both `--lightning-key /path/to/admin.macaroon` and `--lightning-key 0201036c6e64...`.

**Implementation notes:** The backend instance is passed to `createTollBooth({ backend })`. This requires:
1. Adding `lightning`, `lightningUrl`, and `lightningKey` fields to `TokenTollConfig` interface in `src/config.ts`
2. Adding a `backend?: LightningBackend` field to `TokenTollConfig`
3. Instantiating the backend in `src/cli.ts` after config is resolved, before calling `createTokenTollServer()`
4. Threading the backend through to `createTollBooth()` in `src/server.ts`

When `--lightning` is omitted, no backend is passed — toll-booth runs in Cashu-only/synthetic mode (effectively free).

---

## npm Publish Path

### package.json Changes

```json
{
  "files": ["dist"],
  "scripts": {
    "prepublishOnly": "npm run build"
  }
}
```

Add `js-yaml` as a production dependency (with `@types/js-yaml` as devDep). The existing YAML fallback code in `cli.ts` (which attempts JSON parse and warns on failure) must be replaced with actual `js-yaml` parsing.

### Publish Checklist

- Package name: `token-toll` (check availability)
- Dependencies: `@thecryptodonkey/toll-booth@^1.1.2` already on npm
- Engine: `node >= 22.0.0` (Node 22 is LTS)
- Licence: MIT (already set)
- Repository: `TheCryptoDonkey/token-toll` (already set)

### npx Flow

1. npm downloads `token-toll` + deps
2. Runs `dist/bin/token-toll.js`
3. Auto-detects Ollama, starts server, tries tunnel
4. Prints banner

No post-install scripts, no native deps, no build step on the consumer side.

---

## What Needs Building

| Component | Effort | Description |
|-----------|--------|-------------|
| **Lightning backend wiring** | Small | Parse `--lightning` / `--lightning-url` / `--lightning-key`, instantiate toll-booth backend, pass to `createTollBooth()` |
| **Auth middleware layer** | Medium | New `src/auth/` — open/lightning/allowlist router, identity extraction (Bearer + NIP-98) |
| **Tunnel management** | Medium | Spawn `cloudflared` child process, parse URL, clean shutdown, `--no-tunnel` flag |
| **CLI flag updates** | Small | New flags, update help text, update config merging |
| **Startup banner update** | Small | Show Lightning backend, auth mode, tunnel URL |
| **Ollama auto-detect** | Small | Probe `:11434/v1/models` when no `--upstream` |
| **Flat pricing mode** | Small | `--price N` sets fixed hold amount per request |
| **npm publish prep** | Tiny | `files`, `prepublishOnly`, add `js-yaml` dep |
| **README** | Medium | Quick-start for all tiers, flag reference, examples |

### Already Built (Minor Modifications Only)

- Hono server, proxy handler, streaming, token counting — proxy handler needs conditional reconciliation skip for flat pricing mode
- toll-booth integration (L402 flow, macaroons, credit ledger) — `server.ts` needs to accept and thread `backend` option through to `createTollBooth()`
- Discovery endpoints (well-known, llms.txt, OpenAPI, health) — no changes
- Capacity management — no changes
- Config file loading (precedence hierarchy) — needs new fields added, YAML parsing replaced with `js-yaml`
- CLI arg parsing — needs new flags added to switch/case
- Startup banner — needs new lines for Lightning, auth, tunnel
- 52 tests passing — new tests needed for new features
