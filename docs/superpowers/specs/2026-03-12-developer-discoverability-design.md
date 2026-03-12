# Developer Discoverability — Design Spec

**Date:** 2026-03-12
**Scope:** toll-booth, token-toll, l402-mcp
**Goal:** Make the three packages findable, consistent, and cross-linked so that developers and AI agents can discover the ecosystem and understand how the pieces fit together.

---

## 1. Missing hygiene files

### token-toll

- **LICENSE** — MIT, 2026, TheCryptoDonkey. Copy format from toll-booth.
- **MISSION.md** — Payment-rail agnostic inference story. Core message: token-toll is the product layer (token counting, model pricing, capacity, streaming) on top of toll-booth's payment-agnostic middleware. Neither L402 nor x402 provide AI-specific features — they're payment protocols. token-toll is the product.
- **package.json** — Add missing fields:
  - `homepage`: `"https://github.com/TheCryptoDonkey/token-toll"`
  - `author`: `"TheCryptoDonkey"`
  - `bugs`: `{ "url": "https://github.com/TheCryptoDonkey/token-toll/issues" }`

### l402-mcp

- **package.json** — Add missing field:
  - `homepage`: `"https://github.com/TheCryptoDonkey/l402-mcp"`

### toll-booth

- **package.json** — Update `description` from `"Any API becomes a Lightning toll booth in one line. L402 middleware for Express, Hono, Deno, Bun, and Workers"` to `"Monetise any API with HTTP 402 payments. Payment-rail agnostic middleware for Express, Hono, Deno, Bun, and Workers."`

---

## 2. llms.txt files

### token-toll/llms.txt

Content should cover:
- What it does (pay-per-token inference proxy for OpenAI-compatible endpoints)
- Payment-rail agnostic positioning (Lightning, Cashu, NWC today; x402 stablecoins coming)
- Supported inference endpoints (`/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`)
- Discovery endpoints (`.well-known/l402`, `/llms.txt`, `/openapi.json`, `/v1/models`)
- Configuration basics (upstream URL, model pricing, free tier, capacity)
- Relationship to toll-booth (payment middleware under the hood) and l402-mcp (agent client counterpart)
- Quick start: `npx token-toll --upstream http://localhost:11434`

### l402-mcp/llms.txt

Content should cover:
- What it does (MCP server giving AI agents economic agency)
- The 8 MCP tools it exposes and when to use each:
  - Core L402: `l402_config`, `l402_discover`, `l402_fetch`, `l402_pay`, `l402_credentials`, `l402_balance`
  - toll-booth extensions: `l402_buy_credits`, `l402_redeem_cashu`
- Payment methods in priority order (NWC, Cashu, human-in-the-loop)
- Safety model (`MAX_AUTO_PAY_SATS` budget cap)
- Relationship to toll-booth (server counterpart) and token-toll (inference use case)
- Quick start: `npx l402-mcp`

Both files should cross-reference each other and toll-booth to tell the ecosystem story.

---

## 3. README badges and cross-linking

### Badges (all three projects)

Add up to four badges per project, after the existing MIT/Nostr badges:
- npm version (once published)
- Build status (GitHub Actions CI)
- TypeScript badge
- Node version requirement

No badge walls. Keep it tight.

### Ecosystem section (all three READMEs)

Add a consistent **Ecosystem** section to each README. Same three lines, same order. The current project gets emphasis:

```markdown
## Ecosystem

| Project | Role |
|---------|------|
| [toll-booth](https://github.com/TheCryptoDonkey/toll-booth) | Payment-rail agnostic HTTP 402 middleware |
| [token-toll](https://github.com/TheCryptoDonkey/token-toll) | Pay-per-token AI inference proxy (built on toll-booth) |
| [l402-mcp](https://github.com/TheCryptoDonkey/l402-mcp) | MCP client — AI agents discover, pay, and consume L402 APIs |
```

Current project row gets **bold** treatment. Placement: after the main features/content, before Support/Licence sections.

---

## 4. toll-booth package.json description

Update from:
> Any API becomes a Lightning toll booth in one line. L402 middleware for Express, Hono, Deno, Bun, and Workers

To:
> Monetise any API with HTTP 402 payments. Payment-rail agnostic middleware for Express, Hono, Deno, Bun, and Workers.

Keeps the framework list for npm search discoverability. Drops "Lightning" as the lead identity.

---

## 5. Out of scope

The following are explicitly **not** part of this sub-project:
- Landing pages, websites, or static sites
- Demo videos or GIFs for token-toll or l402-mcp
- X threads, Nostr announcements, or other social content
- Unified branding guidelines
- OpenAPI specs (token-toll already serves one dynamically)
- CONTRIBUTING.md, CHANGELOG.md, SECURITY.md
- Examples directories
- Blog posts or long-form content

---

## Deliverables summary

| Repo | Changes |
|------|---------|
| **token-toll** | LICENSE, MISSION.md, llms.txt, package.json fields, README ecosystem section + badges |
| **l402-mcp** | llms.txt, package.json homepage, README ecosystem section + badges |
| **toll-booth** | package.json description, README ecosystem section + badges |

Each repo committed and pushed independently.
