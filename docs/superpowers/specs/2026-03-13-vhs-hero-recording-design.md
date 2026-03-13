# VHS Hero Recording Design — token-toll README

**Date:** 2026-03-13
**Status:** Draft
**Scope:** Create a VHS terminal recording GIF for the top of token-toll's README

---

## Context

The token-toll README has a `<!-- TODO -->` placeholder for a hero GIF. This recording is the first visual impression — it needs to show token-toll is real, fast, and earns money. The toll-booth repo already has a VHS demo (`demo/demo.tape`) that we use as a style template.

## Requirements

- VHS 0.11.0 (installed at `/opt/homebrew/bin/vhs`)
- Local Ollama running with `qwen3:0.6b` model loaded
- No real Lightning infrastructure — mock backend that auto-settles
- Total viewing time under 20 seconds
- Match toll-booth's demo style: Catppuccin Mocha, 1200x600, FontSize 16

## Design

### Files to Create

| File | Purpose |
|------|---------|
| `demo/demo.ts` | Token-toll server with mock Lightning backend, pointed at real Ollama |
| `demo/demo.tape` | VHS tape — four scenes |
| `demo/prompt.json` | Chat completion request body |

### demo/prompt.json

```json
{
  "model": "qwen3:0.6b",
  "messages": [{ "role": "user", "content": "Say hello in 5 words" }]
}
```

Small model, short prompt, deterministic-ish response. Keeps inference fast (~1-2s).

### demo/demo.ts

A standalone script that boots a real token-toll server with:
- **Upstream:** `http://localhost:11434` (real Ollama)
- **Lightning:** Mock backend that auto-settles invoices immediately (no timeout delay — instant settle for demo speed)
- **Storage:** In-memory
- **Auth:** Lightning mode (pay-per-request via toll-booth)
- **Free tier:** 1 request per day (so Scene 2 gets a free pass, Scene 3 hits the paywall)
- **Pricing:** 1 sat per 1k tokens (default)
- **Port:** 3000
- **Tunnel:** Disabled (local demo)
- **Logger:** Pretty format with event callbacks wired

The script should:
1. Import from token-toll's own modules (`createTokenTollServer`, `loadConfig`, `createLogger`)
2. Create a mock Lightning backend similar to toll-booth's `demo/demo.ts` but using token-toll's types
3. Auto-detect models from Ollama on startup
4. Print the standard token-toll startup banner via the logger
5. Wire toll-booth event callbacks (`onPayment`, `onRequest`, `onChallenge`) to the logger

The mock Lightning backend should auto-settle invoices **immediately** (not after 1s like toll-booth's demo) to keep the VHS recording snappy.

### demo/demo.tape

Four scenes following toll-booth's pattern:

**Settings:**
```
Output "demo/token-toll-demo.gif"
Require bash curl jq
Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 600
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 24
Set PlaybackSpeed 1
```

**Hidden setup:** Export PATH for Node.js, cd to project root.

**Scene 1: Boot (4s)**
```
npx tsx demo/demo.ts &
```
Server starts. Banner prints: version, upstream (Ollama auto-detected), models, Lightning (mock), pricing, storage, discovery endpoints. Hold 3s for viewer to absorb.

**Scene 2: Free request (5s)**
Clear screen. Type:
```
curl -s localhost:3000/v1/chat/completions -d @demo/prompt.json | jq .choices[0].message.content
```
Real Ollama response appears. Then echo: `# Free tier — no payment needed`. Hold 3s.

**Scene 3: Paywall (4s)**
Clear screen. Type:
```
curl -s -w '\nHTTP %{http_code}\n' -o /dev/null localhost:3000/v1/chat/completions -d @demo/prompt.json
```
Shows `HTTP 402`. Then echo: `# Free tier exhausted — 402 Payment Required`. Hold 3s.

**Scene 4: Paid request (5s)**
Hidden: create invoice via `curl -s -X POST localhost:3000/create-invoice`, wait for auto-settle, extract macaroon and preimage from invoice status endpoint. Then visible:
```
curl -s -H "Authorization: L402 $MAC:$PRE" localhost:3000/v1/chat/completions -d @demo/prompt.json | jq .choices[0].message.content
```
Real response. Then echo: `# Paid with Lightning — 1 sat per 1k tokens`. Hold 4s.

**Cleanup:** Hidden `kill %1`.

### README Integration

Replace the `<!-- TODO -->` comment in README.md with:

```markdown
![token-toll demo](demo/token-toll-demo.gif)
```

## Timing Budget

| Scene | Typing | Execution | Hold | Total |
|-------|--------|-----------|------|-------|
| 1: Boot | 1s | 3s | 3s | ~4s |
| 2: Free request | 2s | 2s | 3s | ~5s |
| 3: Paywall | 2s | 1s | 3s | ~4s |
| 4: Paid request | 2s | 2s | 4s | ~5s |
| **Total** | | | | **~18s** |

## Dependencies

- `demo/demo.ts` imports from token-toll's own source modules — no new npm dependencies needed
- The mock Lightning backend is self-contained (uses `node:crypto` for preimage/hash generation)
- `bolt11` is already a devDependency for generating valid BOLT11 invoices in the mock
- VHS requires `bash`, `curl`, `jq` (all available)

## Success Criteria

1. Running `vhs demo/demo.tape` produces a clean GIF under 20 seconds
2. The GIF shows real Ollama inference (not canned responses)
3. The payment flow is visible: free → 402 → paid
4. The startup banner shows real model names
5. The GIF renders well at README width on GitHub (~800px displayed)
