# token-toll

[![MIT licence](https://img.shields.io/badge/licence-MIT-blue.svg)](./LICENSE)
[![Nostr](https://img.shields.io/badge/Nostr-Zap%20me-purple)](https://primal.net/p/npub1mgvlrnf5hm9yf0n5mf9nqmvarhvxkc6remu5ec3vf8r0txqkuk7su0e7q2)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D22-green)](https://nodejs.org/)

**Monetise any OpenAI-compatible endpoint in 30 seconds.**

Sits in front of Ollama, vLLM, llama.cpp, or any OpenAI-compatible API and charges per token. Lightning, Cashu, NWC — whatever the client wants to pay with. No accounts, no API keys, instant settlement.

---

## Quick start

```bash
npx token-toll --upstream http://localhost:11434
```

That's it. token-toll auto-detects your models, starts accepting payments, and proxies inference requests to your backend. Clients pay per token, you earn sats.

---

## The old way vs token-toll

| | The old way | With token-toll |
|---|---|---|
| **Step 1** | Create a Stripe account, verify identity | `npx token-toll --upstream http://localhost:11434` |
| **Step 2** | Build user accounts, auth, API key management | Done. No accounts needed. |
| **Step 3** | Implement usage tracking and metering | Done. Tokens counted automatically. |
| **Step 4** | Build a billing page, handle invoices | Done. Pay-per-token, settle instantly. |
| **Step 5** | Handle chargebacks, disputes, refunds | Done. Payments are final. |

---

## Features

- **Pay-per-token** — actual token usage counted from the response, not estimated. Supports both streaming SSE and buffered responses.
- **Model-specific pricing** — charge different rates per model (e.g. 1 sat/1k tokens for Llama 3, 5 sats/1k for DeepSeek R1).
- **Payment-rail agnostic** — powered by [toll-booth](https://github.com/TheCryptoDonkey/toll-booth) under the hood. Accepts Lightning, Cashu ecash, and NWC today. Stablecoins (x402) coming soon.
- **Volume discounts** — configurable payment tiers with bonus credits (e.g. pay 5,000 sats, get 5,500 in credit).
- **Free tier** — give away N requests per IP per day before the paywall kicks in.
- **Capacity management** — limit concurrent inference requests to protect your GPU.
- **Auto-detect models** — queries your upstream `/v1/models` on startup, no manual model list needed.
- **AI-discoverable** — serves `/.well-known/l402`, `/llms.txt`, and `/openapi.json` so agents can find and understand your endpoint.
- **Streaming support** — proxies SSE streams with real-time token counting and post-stream cost reconciliation.
- **Zero dependencies on inference** — works with any backend that speaks the OpenAI API format.

---

## Configuration

token-toll works with zero configuration (just `--upstream`), but for production you'll want a config file.

Create `token-toll.yaml` in your working directory:

```yaml
upstream: http://localhost:11434
port: 3000
storage: sqlite
dbPath: ./token-toll.db

pricing:
  default: 1          # 1 sat per 1k tokens
  models:
    llama3: 1
    deepseek-r1: 5
    mixtral-8x22b: 3

freeTier:
  requestsPerDay: 5

capacity:
  maxConcurrent: 4

tiers:
  - amountSats: 1000
    creditSats: 1000
    label: "1,000 sats"
  - amountSats: 5000
    creditSats: 5500
    label: "5,000 sats (10% bonus)"
  - amountSats: 10000
    creditSats: 11100
    label: "10,000 sats (11% bonus)"
```

Configuration precedence: **CLI flags > environment variables > config file > defaults**.

Key environment variables: `UPSTREAM_URL`, `ROOT_KEY`, `PORT`, `STORAGE`, `DEFAULT_PRICE`, `FREE_TIER_REQUESTS`, `MAX_CONCURRENT`.

---

## How it works

```
Client ──> token-toll ──> Your inference backend
              │                    │
              │  1. 402 challenge  │
              │  2. Client pays    │
              │  3. Proxy request ─┘
              │  4. Count tokens
              │  5. Reconcile cost
              │  6. Refund overpayment
```

1. Client hits `/v1/chat/completions` (or `/v1/completions`, `/v1/embeddings`).
2. token-toll returns HTTP 402 with a payment challenge.
3. Client pays via Lightning/Cashu/NWC and retries with the credential.
4. token-toll proxies the request upstream and counts tokens in the response.
5. After the response completes, the actual token cost is reconciled against the prepayment.
6. Any overpayment is credited back to the client's balance.

token-toll charges an estimated amount upfront (based on model pricing), then reconciles to the actual token count. Operators are never short-changed — costs always round up.

---

## AI agent compatibility

token-toll is designed for autonomous AI agent consumption. It exposes three discovery endpoints — no authentication required:

| Endpoint | Purpose |
|---|---|
| `/.well-known/l402` | Machine-readable service descriptor (pricing, models, payment methods) |
| `/llms.txt` | LLM-friendly plain text describing the endpoint |
| `/openapi.json` | Full OpenAPI spec for client code generation |
| `/v1/models` | Standard OpenAI model listing (proxied from upstream) |

Pair with [l402-mcp](https://github.com/TheCryptoDonkey/l402-mcp) to let AI agents discover, pay, and consume your endpoint autonomously:

```
AI Agent -> l402-mcp -> token-toll -> Your GPU
```

No OAuth dance, no API key rotation, no billing portal. The agent pays per token from its own wallet.

See the full [ecosystem architecture](https://github.com/TheCryptoDonkey/toll-booth/blob/main/docs/architecture.md) for how the layers fit together.

---

## Programmatic usage

token-toll also exports its internals as a library:

```typescript
import { createTokenTollServer, loadConfig } from 'token-toll'

const config = loadConfig(
  { upstream: 'http://localhost:11434' },
  process.env,
)
const { app } = createTokenTollServer(config)
```

---

## Ecosystem

| Project | Role |
|---------|------|
| [toll-booth](https://github.com/TheCryptoDonkey/toll-booth) | Payment-rail agnostic HTTP 402 middleware |
| **[token-toll](https://github.com/TheCryptoDonkey/token-toll)** | **Pay-per-token AI inference proxy (built on toll-booth)** |
| [l402-mcp](https://github.com/TheCryptoDonkey/l402-mcp) | MCP client — AI agents discover, pay, and consume L402 APIs |

---

## Support

Built by [@TheCryptoDonkey](https://github.com/TheCryptoDonkey).

- Lightning tips: `thedonkey@strike.me`
- Nostr: `npub1mgvlrnf5hm9yf0n5mf9nqmvarhvxkc6remu5ec3vf8r0txqkuk7su0e7q2`

---

## Licence

[MIT](./LICENSE)
