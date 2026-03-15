# Contributing to satgate

## Setup

```bash
git clone https://github.com/TheCryptoDonkey/satgate.git
cd satgate
npm install
```

Requires **Node.js >= 22**.

## Development

```bash
# Run locally (needs an upstream like Ollama on localhost:11434)
npm run dev -- --upstream http://localhost:11434

# Type-check
npm run typecheck

# Run tests
npm test

# Build
npm run build
```

## Testing

Tests use [Vitest](https://vitest.dev/) and live in `*.test.ts` files alongside the source. Run the full suite with `npm test` or a single file with `npx vitest run src/proxy/pricing.test.ts`.

## Project structure

```
src/
  cli.ts              CLI entry point
  server.ts           Hono server setup
  config.ts           Configuration loading (CLI > env > YAML > defaults)
  index.ts            Public API exports
  logger.ts           Structured logging
  lightning.ts        Lightning backend integration
  tunnel.ts           Cloudflare tunnel management
  auth/
    middleware.ts      L402 authentication middleware
    allowlist.ts       IP/path allowlisting
  proxy/
    handler.ts         Request proxy handler
    streaming.ts       SSE streaming proxy
    token-counter.ts   Token counting from OpenAI responses
    pricing.ts         Model price resolution
    capacity.ts        Concurrent request limiting
  discovery/
    well-known.ts      /.well-known/l402 endpoint
    llms-txt.ts        /llms.txt endpoint
    openapi.ts         /openapi.json endpoint
  x402/
    facilitator.ts     x402 stablecoin support
```

## Conventions

- **TypeScript** — strict mode, no `any` where avoidable
- **British English** in user-facing text (colour, monetise, licence)
- **Commit messages** — `type: description` format (e.g. `feat:`, `fix:`, `docs:`, `refactor:`)
- **No default exports** — use named exports throughout

## Submitting changes

1. Fork and create a feature branch
2. Make your changes with tests
3. Run `npm test` and `npm run typecheck`
4. Open a pull request against `main`
