# README Messaging Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite token-toll's README and update toll-booth's README so the pair works as a funnel: impress with the product, reveal the engine, drive adoption of toll-booth.

**Architecture:** Documentation-only changes across two repos. token-toll gets a full README rewrite. toll-booth gets one new section and a table tweak. Visual assets (mermaid diagrams) are inline. VHS recordings are specced but produced separately.

**Tech Stack:** Markdown, Mermaid diagrams, VHS (for terminal recordings, separate task)

**Spec:** `docs/superpowers/specs/2026-03-13-readme-messaging-design.md`

---

## Pre-implementation Notes

- x402 is in the codebase (9 source files reference it), so "four payment rails" is accurate.
- `docs/configuration.md` does not exist. The config section will link to a future doc or be self-contained.
- The AI-specific proxy code (handler, streaming, token-counter, pricing, capacity) is 446 lines — "~400 lines of glue" is honest.
- VHS terminal recordings require a running token-toll instance with mock Lightning. These are out of scope for this plan and will be a follow-up task. The README will include a placeholder comment for where the GIF goes.

---

## Chunk 1: token-toll README Rewrite

### Task 1: Write the new token-toll README

**Files:**
- Modify: `README.md` (full rewrite)

- [ ] **Step 1: Replace README.md with the new content**

Write the complete new README following the spec's eight sections:

```markdown
# token-toll

[![MIT licence](https://img.shields.io/badge/licence-MIT-blue.svg)](./LICENSE)
[![Nostr](https://img.shields.io/badge/Nostr-Zap%20me-purple)](https://primal.net/p/npub1mgvlrnf5hm9yf0n5mf9nqmvarhvxkc6remu5ec3vf8r0txqkuk7su0e7q2)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D22-green)](https://nodejs.org/)

**Your GPU is burning money. Make it earn money.**

token-toll sits in front of Ollama, vLLM, llama.cpp — any OpenAI-compatible backend — and turns it into a pay-per-token API. No accounts. No API keys. No Stripe. Clients pay per token, you earn sats before the response finishes streaming.

<!-- TODO: VHS terminal recording goes here — startup, request, payment, inference, sats earned -->

## Quick start

​```bash
npx token-toll --upstream http://localhost:11434
​```

That's it. token-toll auto-detects your models, starts accepting payments, and proxies inference requests. Clients pay per token, you earn sats.

---

## The old way vs token-toll

| | The old way | With token-toll |
|---|---|---|
| **Sell GPU time** | Sign up for a marketplace (OpenRouter, Together). They set the price, take a cut, own the customer. | `npx token-toll --upstream http://localhost:11434`. You set the price. You keep 100%. |
| **Handle billing** | Stripe account, KYC, usage tracking, invoices, chargebacks | Payments settle before the response finishes streaming. No accounts, no disputes. |
| **Serve AI agents** | OAuth flows, API key management, billing portals — none of which machines can use | Agents discover your endpoint, pay per token from their own wallet, no human in the loop. |
| **Price fairly** | Flat rate per request, regardless of whether it's 10 tokens or 10,000 | Actual tokens counted from the response. Overpayments credited back. |

---

## Built for machines

token-toll doesn't just serve humans with `curl`. It's designed for AI agents that pay for their own resources.

Every token-toll instance exposes three discovery endpoints — no auth required:

| Endpoint | Who reads it |
|---|---|
| `/.well-known/l402` | Machines — pricing, models, payment methods as structured JSON |
| `/llms.txt` | AI agents — plain-text description of what you're selling |
| `/openapi.json` | Code generators — full OpenAPI spec |

Pair with [l402-mcp](https://github.com/TheCryptoDonkey/l402-mcp) and an AI agent can autonomously discover your endpoint, check your prices, pay from its own wallet, and start prompting — no human involved.

​```mermaid
sequenceDiagram
    participant A as AI Agent
    participant M as l402-mcp
    participant T as token-toll
    participant G as Your GPU

    A->>M: "Use this inference endpoint"
    M->>T: GET /.well-known/l402
    T-->>M: Pricing, models, payment methods
    M->>T: POST /v1/chat/completions
    T-->>M: 402 + Lightning invoice
    M->>M: Pay invoice from wallet
    M->>T: Retry with L402 credential
    T->>G: Proxy request
    G-->>T: Stream response
    T-->>M: Stream completion
    M-->>A: Response
​```

---

## The secret

Everything you just saw — the payment gating, the multi-rail support, the credit system, the free tier, the macaroon credentials — that's not token-toll. That's [toll-booth](https://github.com/TheCryptoDonkey/toll-booth).

token-toll is ~400 lines of glue on top of toll-booth. It adds the AI-specific bits: token counting, model pricing, streaming reconciliation, capacity management. Everything else comes from the middleware.

**You could build your own token-toll for your domain in an afternoon.**

Monetise a routing API. Gate a translation service. Sell weather data per request. toll-booth handles the payments — you just write the product logic.

→ [**See toll-booth**](https://github.com/TheCryptoDonkey/toll-booth)

​```mermaid
graph TB
    subgraph "token-toll (~400 lines)"
        TC[Token counting]
        MP[Model pricing]
        SR[Streaming reconciliation]
        CM[Capacity management]
        AD[Agent discovery]
    end
    subgraph "toll-booth"
        L402[L402 protocol]
        CR[Credit system]
        FT[Free tier]
        PR[Payment rails]
        MA[Macaroon auth]
    end
    TC --> L402
    MP --> CR
    SR --> CR
    CM --> L402
    AD --> L402
​```

---

## What token-toll adds

- **Pay-per-token** — actual token count from the response, not estimated. Streaming and buffered.
- **Model-specific pricing** — 1 sat/1k for Llama, 5 sats/1k for DeepSeek. You set the rates.
- **Streaming reconciliation** — estimated charge upfront, reconciled to actual usage after. Overpayments credited back.
- **Capacity management** — limit concurrent inference requests to protect your GPU.
- **Auto-detect models** — queries your upstream on startup. No manual model list.
- **Four payment rails** — Lightning, Cashu ecash, NWC, and x402 stablecoins. Operator picks what to accept.
- **Instant public URL** — auto-spawns a Cloudflare tunnel. Your GPU is reachable from the internet in seconds.

---

## How it works

​```mermaid
sequenceDiagram
    participant C as Client
    participant T as token-toll
    participant G as Your GPU

    C->>T: POST /v1/chat/completions
    T-->>C: 402 + Lightning invoice (estimated cost)
    C->>C: Pay invoice
    C->>T: Retry with L402 credential
    T->>G: Proxy request
    G-->>T: Stream response
    T->>T: Count actual tokens
    T-->>C: Stream completion
    T->>T: Reconcile: credit back overpayment
​```

Charges are estimated upfront based on model pricing, then reconciled to actual token usage after the response completes. Operators are never short-changed — costs round up. Overpayments are credited to the client's balance for the next request.

---

## Configuration

Zero config works (just `--upstream`). For production, create `token-toll.yaml`:

​```yaml
upstream: http://localhost:11434
port: 3000
pricing:
  default: 1          # 1 sat per 1k tokens
  models:
    llama3: 1
    deepseek-r1: 5
freeTier:
  requestsPerDay: 5
capacity:
  maxConcurrent: 4
​```

CLI flags > environment variables > config file > defaults.

---

## Get started

​```bash
# Monetise your local Ollama
npx token-toll --upstream http://localhost:11434

# Or point at any OpenAI-compatible backend
npx token-toll --upstream http://your-vllm-server:8000
​```

→ [**toll-booth**](https://github.com/TheCryptoDonkey/toll-booth) — the middleware that powers all of this. Build your own.
→ [**l402-mcp**](https://github.com/TheCryptoDonkey/l402-mcp) — give AI agents a wallet. Let them pay for your GPU.

---

Built by [@TheCryptoDonkey](https://github.com/TheCryptoDonkey).

- Lightning tips: `thedonkey@strike.me`
- Nostr: `npub1mgvlrnf5hm9yf0n5mf9nqmvarhvxkc6remu5ec3vf8r0txqkuk7su0e7q2`

---

[MIT](./LICENSE)
```

- [ ] **Step 2: Verify mermaid renders correctly**

Open the README in a markdown previewer that supports mermaid (GitHub, WebStorm) and check all three diagrams render:
1. Agent flow sequence diagram (Built for machines)
2. Architecture layer graph (The secret)
3. Payment flow sequence diagram (How it works)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README with product-with-a-secret messaging"
```

---

## Chunk 2: toll-booth README Updates

### Task 2: Add "See it in production" section to toll-booth

**Files:**
- Modify: `/Users/darren/WebstormProjects/toll-booth/README.md`

- [ ] **Step 1: Add "See it in production" section after "Five zeroes"**

Insert after the "Five zeroes" section (after line 66, before "Let AI agents pay for your API"):

```markdown
---

## See it in production

[**token-toll**](https://github.com/TheCryptoDonkey/token-toll) is a pay-per-token AI inference proxy built on toll-booth. It monetises any OpenAI-compatible endpoint — Ollama, vLLM, llama.cpp — with one command. Token counting, model pricing, streaming reconciliation, capacity management. Everything else — payments, credits, free tier, macaroon auth — is toll-booth.

~400 lines of product logic on top of the middleware. That's what "monetise any API with one line of code" looks like in practice.
```

- [ ] **Step 2: Update ecosystem table**

Change the token-toll entry from:

```markdown
| [token-toll](https://github.com/TheCryptoDonkey/token-toll) | Pay-per-token AI inference proxy (built on toll-booth) |
```

To:

```markdown
| [token-toll](https://github.com/TheCryptoDonkey/token-toll) | Production showcase — pay-per-token AI inference proxy (~400 lines on toll-booth) |
```

And update the l402-mcp entry from:

```markdown
| [l402-mcp](https://github.com/TheCryptoDonkey/l402-mcp) | MCP client — AI agents discover, pay, and consume L402 APIs |
```

To:

```markdown
| [l402-mcp](https://github.com/TheCryptoDonkey/l402-mcp) | Client side — AI agents discover, pay, and consume L402 APIs |
```

- [ ] **Step 3: Verify the README reads well end-to-end**

Read through the full toll-booth README to check the new section flows naturally between "Five zeroes" and "Let AI agents pay for your API."

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add token-toll production showcase section, update ecosystem table"
```

---

## Chunk 3: Follow-up Items (out of scope, tracked here)

These are not part of this plan but should be done next:

1. **VHS terminal recording** — record the hero GIF for token-toll README. Requires running token-toll with mock Lightning backend. Replace the `<!-- TODO -->` comment.
2. **`docs/configuration.md`** — create a full configuration reference for token-toll so the README can link to it.
3. **Optional: split-terminal agent demo** — VHS recording showing AI agent (l402-mcp) and token-toll logs side by side.
