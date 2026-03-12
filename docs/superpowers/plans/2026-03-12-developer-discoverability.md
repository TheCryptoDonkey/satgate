# Developer Discoverability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make toll-booth, token-toll, and l402-mcp findable, consistent, and cross-linked so developers and AI agents can discover the ecosystem and understand how the pieces fit together.

**Architecture:** Pure documentation/metadata changes across three repos. No code changes. Each repo committed and pushed independently. READMEs are touched last to minimise merge conflict risk (other work may be happening on them).

**Tech Stack:** Markdown, JSON (package.json), git

**Repos:**
- toll-booth: `/Users/darren/WebstormProjects/toll-booth`
- token-toll: `/Users/darren/WebstormProjects/token-toll`
- l402-mcp: `/Users/darren/WebstormProjects/l402-mcp`

---

## Chunk 1: Hygiene files and package.json metadata

### Task 1: Add LICENSE to token-toll

**Files:**
- Create: `token-toll/LICENSE`

- [ ] **Step 1: Create LICENSE file**

```
MIT License

Copyright (c) 2026 TheCryptoDonkey

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Commit**

```bash
cd /Users/darren/WebstormProjects/token-toll
git add LICENSE
git commit -m "chore: add MIT licence"
```

---

### Task 2: Add MISSION.md to token-toll

**Files:**
- Create: `token-toll/MISSION.md`

- [ ] **Step 1: Create MISSION.md**

```markdown
# Mission

**token-toll exists to let anyone monetise AI inference in seconds — pay-per-token, any payment rail, no accounts, no middlemen.**

LLM inference costs real money — GPUs, electricity, bandwidth. But the tools for selling access are stuck in the Stripe era: sign-up forms, API key management, billing dashboards, subscription tiers. None of it works for machines. None of it settles instantly. None of it is permissionless.

token-toll sits in front of any OpenAI-compatible endpoint and handles the rest. Clients pay per token. The payment settles before the response finishes streaming. The operator earns from the first request.

We believe:

- **Payment rails are pluggable, not tribal.** Lightning, Cashu, NWC today. x402 stablecoins tomorrow. The operator picks what to accept. The client picks what to pay with. token-toll doesn't care — it just counts tokens and settles the bill.
- **The product layer matters.** Neither L402 nor x402 know what a token is. They're payment protocols. token-toll adds the AI-specific concerns: token counting, model pricing, capacity management, streaming support, cost reconciliation. Payment protocols move money. token-toll is the product.
- **Inference should be a vending machine.** No accounts. No API keys. No billing portal. Hit the endpoint, pay the price, get the completion. Machines and humans alike.
- **Operators deserve fairness.** Estimated charges upfront, actual token counts after. Overpayments credited back. Operators are never short-changed.
- **Simplicity wins.** `npx token-toll --upstream http://localhost:11434` — that's the whole setup. If it's harder than that, we failed.
```

- [ ] **Step 2: Commit**

```bash
cd /Users/darren/WebstormProjects/token-toll
git add MISSION.md
git commit -m "docs: add mission statement"
```

---

### Task 3: Fix package.json metadata across all three repos

**Files:**
- Modify: `token-toll/package.json`
- Modify: `l402-mcp/package.json`
- Modify: `toll-booth/package.json`

- [ ] **Step 1: Update token-toll package.json**

Add after the `"repository"` block:

```json
"homepage": "https://github.com/TheCryptoDonkey/token-toll",
"author": "TheCryptoDonkey",
"bugs": {
  "url": "https://github.com/TheCryptoDonkey/token-toll/issues"
},
```

- [ ] **Step 2: Commit token-toll**

```bash
cd /Users/darren/WebstormProjects/token-toll
git add package.json
git commit -m "chore: add homepage, author, bugs to package.json"
```

- [ ] **Step 3: Update l402-mcp package.json**

Add `homepage` field:

```json
"homepage": "https://github.com/TheCryptoDonkey/l402-mcp",
```

- [ ] **Step 4: Commit l402-mcp**

```bash
cd /Users/darren/WebstormProjects/l402-mcp
git add package.json
git commit -m "chore: add homepage to package.json"
```

- [ ] **Step 5: Update toll-booth package.json description**

Change `description` from:
```
"Any API becomes a Lightning toll booth in one line. L402 middleware for Express, Hono, Deno, Bun, and Workers."
```
To:
```
"Monetise any API with HTTP 402 payments. Payment-rail agnostic middleware for Express, Hono, Deno, Bun, and Workers."
```

- [ ] **Step 6: Commit toll-booth**

```bash
cd /Users/darren/WebstormProjects/toll-booth
git add package.json
git commit -m "chore: update description to payment-rail agnostic positioning"
```

---

## Chunk 2: llms.txt files

### Task 4: Create token-toll/llms.txt

**Files:**
- Create: `token-toll/llms.txt`

Reference: Use `toll-booth/llms.txt` as the style template. Match the structure: overview paragraph, getting started, key concepts, API surface, optional resources.

- [ ] **Step 1: Create llms.txt**

Content must cover (in this order):
1. Overview paragraph — what it does (pay-per-token inference proxy for OpenAI-compatible endpoints), payment-rail agnostic (Lightning, Cashu, NWC today; x402 coming)
2. Getting started — `npx token-toll --upstream http://localhost:11434`, YAML config example
3. Key concepts — model pricing (per-model rates, default fallback, fuzzy matching), token counting (buffered, SSE, fallback), capacity management, free tier, payment tiers with volume discounts, cost reconciliation (estimated upfront, actual after)
4. Supported endpoints — `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`
5. Discovery endpoints — `/.well-known/l402`, `/llms.txt`, `/openapi.json`, `/v1/models`
6. Configuration — CLI flags, env vars, YAML file, precedence order
7. Ecosystem — relationship to toll-booth (payment middleware under the hood) and l402-mcp (agent client counterpart). Include links.

- [ ] **Step 2: Commit**

```bash
cd /Users/darren/WebstormProjects/token-toll
git add llms.txt
git commit -m "docs: add llms.txt for AI discoverability"
```

---

### Task 5: Create l402-mcp/llms.txt

**Files:**
- Create: `l402-mcp/llms.txt`

Reference: Use `toll-booth/llms.txt` as the style template.

- [ ] **Step 1: Create llms.txt**

Content must cover (in this order):
1. Overview paragraph — what it does (MCP server giving AI agents economic agency), protocol-loyal (works with any L402 server), three payment methods
2. Getting started — `npx l402-mcp` (stdio), `TRANSPORT=http npx l402-mcp` (HTTP), configuration env vars (NWC_URI, CASHU_TOKENS, MAX_AUTO_PAY_SATS)
3. Core L402 tools (any server):
   - `l402_config` — introspect payment capabilities
   - `l402_discover` — probe endpoint pricing without paying
   - `l402_fetch` — HTTP request with auto L402 handling
   - `l402_pay` — pay a specific invoice
   - `l402_credentials` — list stored credentials
   - `l402_balance` — check cached credit balance
4. toll-booth extension tools:
   - `l402_buy_credits` — browse and purchase volume discount tiers
   - `l402_redeem_cashu` — redeem ecash tokens directly
5. Payment methods — NWC (fully autonomous), Cashu (fully autonomous ecash), human-in-the-loop (QR code fallback). Tried in priority order.
6. Safety model — `MAX_AUTO_PAY_SATS` budget cap (default 100), human stays in control
7. Ecosystem — relationship to toll-booth (server counterpart) and token-toll (inference use case). Include links.

- [ ] **Step 2: Commit**

```bash
cd /Users/darren/WebstormProjects/l402-mcp
git add llms.txt
git commit -m "docs: add llms.txt for AI discoverability"
```

---

## Chunk 3: README badges and ecosystem sections

**IMPORTANT:** Read the current state of each README before editing — other work may have changed them since the start of this session.

### Task 6: Add badges and ecosystem section to toll-booth README

**Files:**
- Modify: `toll-booth/README.md`

- [ ] **Step 1: Read current README**

```bash
cd /Users/darren/WebstormProjects/toll-booth
git pull --rebase
```

Then read `README.md` to get current state.

- [ ] **Step 2: Add badges**

After the existing MIT and Nostr badges, add:

```markdown
[![npm](https://img.shields.io/npm/v/@thecryptodonkey/toll-booth)](https://www.npmjs.com/package/@thecryptodonkey/toll-booth)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-green)](https://nodejs.org/)
```

(CI badge skipped — workflow exists but need to confirm repo/branch match before adding.)

- [ ] **Step 3: Add ecosystem section**

Place before the Support section. toll-booth row is **bold**:

```markdown
## Ecosystem

| Project | Role |
|---------|------|
| **[toll-booth](https://github.com/TheCryptoDonkey/toll-booth)** | **Payment-rail agnostic HTTP 402 middleware** |
| [token-toll](https://github.com/TheCryptoDonkey/token-toll) | Pay-per-token AI inference proxy (built on toll-booth) |
| [l402-mcp](https://github.com/TheCryptoDonkey/l402-mcp) | MCP client — AI agents discover, pay, and consume L402 APIs |

---
```

- [ ] **Step 4: Commit**

```bash
cd /Users/darren/WebstormProjects/toll-booth
git add README.md
git commit -m "docs: add badges and ecosystem cross-links to README"
```

---

### Task 7: Add badges and ecosystem section to token-toll README

**Files:**
- Modify: `token-toll/README.md`

- [ ] **Step 1: Read current README**

```bash
cd /Users/darren/WebstormProjects/token-toll
git pull --rebase
```

Then read `README.md` to get current state.

- [ ] **Step 2: Add badges**

After the existing MIT and Nostr badges, add:

```markdown
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D22-green)](https://nodejs.org/)
```

(npm version badge added when published. No CI workflow exists yet.)

- [ ] **Step 3: Add ecosystem section**

Place before the Support section. token-toll row is **bold**:

```markdown
## Ecosystem

| Project | Role |
|---------|------|
| [toll-booth](https://github.com/TheCryptoDonkey/toll-booth) | Payment-rail agnostic HTTP 402 middleware |
| **[token-toll](https://github.com/TheCryptoDonkey/token-toll)** | **Pay-per-token AI inference proxy (built on toll-booth)** |
| [l402-mcp](https://github.com/TheCryptoDonkey/l402-mcp) | MCP client — AI agents discover, pay, and consume L402 APIs |

---
```

- [ ] **Step 4: Commit**

```bash
cd /Users/darren/WebstormProjects/token-toll
git add README.md
git commit -m "docs: add badges and ecosystem cross-links to README"
```

---

### Task 8: Add badges and ecosystem section to l402-mcp README

**Files:**
- Modify: `l402-mcp/README.md`

- [ ] **Step 1: Read current README**

```bash
cd /Users/darren/WebstormProjects/l402-mcp
git pull --rebase
```

Then read `README.md` to get current state.

- [ ] **Step 2: Add badges**

After the existing MIT badge, add:

```markdown
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-green)](https://nodejs.org/)
```

(npm version badge added when published. No CI workflow exists yet.)

- [ ] **Step 3: Add ecosystem section**

Place before the Support section (or Licence if no Support). l402-mcp row is **bold**:

```markdown
## Ecosystem

| Project | Role |
|---------|------|
| [toll-booth](https://github.com/TheCryptoDonkey/toll-booth) | Payment-rail agnostic HTTP 402 middleware |
| [token-toll](https://github.com/TheCryptoDonkey/token-toll) | Pay-per-token AI inference proxy (built on toll-booth) |
| **[l402-mcp](https://github.com/TheCryptoDonkey/l402-mcp)** | **MCP client — AI agents discover, pay, and consume L402 APIs** |

---
```

- [ ] **Step 4: Commit**

```bash
cd /Users/darren/WebstormProjects/l402-mcp
git add README.md
git commit -m "docs: add badges and ecosystem cross-links to README"
```

---

## Chunk 4: Push all repos

### Task 9: Push all repos

- [ ] **Step 1: Push token-toll**

```bash
cd /Users/darren/WebstormProjects/token-toll
git push
```

- [ ] **Step 2: Push toll-booth**

```bash
cd /Users/darren/WebstormProjects/toll-booth
git push
```

- [ ] **Step 3: Push l402-mcp**

```bash
cd /Users/darren/WebstormProjects/l402-mcp
git push
```

- [ ] **Step 4: Verify all repos are clean**

```bash
cd /Users/darren/WebstormProjects/token-toll && git status
cd /Users/darren/WebstormProjects/toll-booth && git status
cd /Users/darren/WebstormProjects/l402-mcp && git status
```

Expected: all three show "nothing to commit, working tree clean" and "Your branch is up to date with 'origin/main'".
