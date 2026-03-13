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
  "messages": [
    { "role": "system", "content": "Respond concisely. No thinking tags." },
    { "role": "user", "content": "Say hello in 5 words" }
  ],
  "stream": false,
  "temperature": 0
}
```

- `stream: false` ensures the response is a single JSON object (not SSE), so `jq` piping works cleanly.
- `temperature: 0` for deterministic output.
- System message suppresses qwen3's `<think>` tags which would look messy in the GIF.

### demo/demo.ts

**Architecture:** The demo script builds the server **manually** rather than using `createTokenTollServer`. This is necessary because the mock Lightning backend needs direct access to the toll-booth storage instance to call `settleWithCredit()` — and `createTokenTollServer` creates storage internally without exposing it.

This mirrors exactly how toll-booth's own `demo/demo.ts` works: build the toll-booth engine manually, wire in a mock backend that has the storage reference, then compose the Hono app with token-toll's proxy handler on top.

**The script should:**

1. Create a `memoryStorage()` from toll-booth
2. Create an inline mock Lightning backend (self-contained, like toll-booth's demo):
   - `createInvoice`: generate preimage + paymentHash, create a fake bolt11 string, immediately call `storage.settleWithCredit(paymentHash, amount, preimage)`, return invoice
   - `checkInvoice`: check `storage.isSettled(paymentHash)`, return paid status + preimage from `storage.getSettlementSecret(paymentHash)`
3. Create a `createTollBooth` engine with the mock backend and storage, wired to token-toll's logger via `onPayment`, `onRequest`, `onChallenge` callbacks
4. Create a `createHonoTollBooth` adapter and mount payment routes
5. Mount token-toll's proxy handler for `/v1/chat/completions` (via `createProxyHandler`)
6. Mount token-toll's discovery endpoints (`/.well-known/l402`, `/llms.txt`, `/openapi.json`)
7. Auto-detect models from Ollama (`fetch http://localhost:11434/v1/models`)
8. Print a startup banner via token-toll's `createLogger`

**Configuration:**
- **Upstream:** `http://localhost:11434` (real Ollama)
- **Lightning:** Inline mock that auto-settles immediately (no setTimeout)
- **Storage:** In-memory (from toll-booth)
- **Free tier:** 1 request per day
- **Pricing:** 1 sat per 1k tokens (default)
- **Port:** 3000
- **Tunnel:** Disabled

**Key imports:**
- From toll-booth: `createTollBooth`, `memoryStorage`, `createHonoTollBooth` (+ Hono adapter)
- From token-toll src: `createProxyHandler`, `createLogger`, `CapacityTracker`, discovery generators
- From node:crypto: `randomBytes`, `createHash`

**The mock Lightning backend does NOT need the `bolt11` library.** Unlike the e2e test mock which generates real BOLT11 invoices (for l402-mcp to decode), the demo just needs any string as the bolt11 field. The VHS tape never decodes the invoice — it only extracts the macaroon and preimage from the `/create-invoice` and `/invoice-status` responses. Use a fake bolt11 string like toll-booth's demo: `` `lnbc${amountSats}n1demo${randomBytes(20).toString('hex')}` ``.

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
Wait 4s (tsx cold start + Ollama model detection). Server banner prints: version, upstream (Ollama), models, Lightning (mock), pricing, storage, discovery endpoints. Hold 3s for viewer to absorb.

**Scene 2: Free request (5s)**
Clear screen. Type:
```
curl -s -H "Content-Type: application/json" localhost:3000/v1/chat/completions -d @demo/prompt.json | jq .choices[0].message.content
```
Real Ollama response appears. Then echo: `# Free tier — no payment needed`. Hold 3s.

**Note:** `-H "Content-Type: application/json"` is required — token-toll's proxy handler validates Content-Type and returns 415 without it. `curl -d` defaults to `application/x-www-form-urlencoded`.

**Scene 3: Paywall (4s)**
Clear screen. Type:
```
curl -s -w '\nHTTP %{http_code}\n' -H "Content-Type: application/json" localhost:3000/v1/chat/completions -d @demo/prompt.json
```
Shows `HTTP 402` (without `-o /dev/null` so the 402 response body is visible — shows the L402 challenge context). Then echo: `# Free tier exhausted — 402 Payment Required`. Hold 3s.

**Scene 4: Paid request (5s)**
Hidden: create invoice, extract credentials:
```bash
# Create invoice (auto-settles immediately via mock)
curl -s -X POST localhost:3000/create-invoice > /tmp/inv.json
sleep 1

# Extract macaroon
MAC=$(jq -r .macaroon /tmp/inv.json)

# Get preimage from invoice status
HASH=$(jq -r .paymentHash /tmp/inv.json)
PRE=$(curl -s localhost:3000/invoice-status/$HASH | jq -r .preimage)
```

Then visible:
```
curl -s -H "Authorization: L402 $MAC:$PRE" -H "Content-Type: application/json" localhost:3000/v1/chat/completions -d @demo/prompt.json | jq .choices[0].message.content
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
| 1: Boot | 1s | 4s | 3s | ~5s |
| 2: Free request | 2s | 2s | 3s | ~5s |
| 3: Paywall | 2s | 1s | 3s | ~4s |
| 4: Paid request | 2s | 2s | 4s | ~5s |
| **Total** | | | | **~19s** |

## Dependencies

- `demo/demo.ts` imports from toll-booth and token-toll's own source modules — no new npm dependencies needed
- The mock Lightning backend is self-contained (uses `node:crypto`, no bolt11 library needed)
- VHS requires `bash`, `curl`, `jq` (all available)
- Ollama must be running with `qwen3:0.6b` loaded

## Success Criteria

1. Running `vhs demo/demo.tape` produces a clean GIF under 20 seconds
2. The GIF shows real Ollama inference (not canned responses)
3. The payment flow is visible: free → 402 → paid
4. The startup banner shows real model names
5. The GIF renders well at README width on GitHub (~800px displayed)
6. No `<think>` tags or messy output in the inference response
