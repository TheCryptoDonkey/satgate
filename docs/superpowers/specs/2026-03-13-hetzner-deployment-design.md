# Hetzner Deployment — Design Spec

**Date:** 2026-03-13
**Status:** Draft

---

## Overview

Deploy token-toll as a third Docker service on the Hetzner VPS (`REDACTED_IP`), proxying a local Ollama instance with Lightning payments via the shared Phoenixd node. Demonstrates per-token pricing, model discovery, and the full toll-booth feature set.

## Existing infrastructure

The VPS already runs:

| Service | Container | Port | Purpose |
|---------|-----------|------|---------|
| Valhalla routing proxy | `routing-routing-proxy-1` | 3000 | Geospatial routing behind L402 |
| sats-for-laughs | `sats-for-laughs` | 3001 | Joke API behind L402 |
| Phoenixd | `routing-phoenixd-1` | 9740 (localhost) | Shared Lightning node |

All services use `--network host` for localhost communication with Phoenixd.

## New containers

Two new standalone containers (not added to the routing docker-compose):

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `ollama` | `ollama/ollama:latest` | 11434 (localhost only, via `OLLAMA_HOST`) | Runs qwen3:0.6b for inference |
| `token-toll` | Built from `Dockerfile` | 3002 (host network) | Lightning-paid inference proxy |

Both use `--network host` to reach Phoenixd and each other on localhost.

## Dockerfile

Multi-stage build following the sats-for-laughs pattern:

1. **Build stage:** Node 22 slim base, copies `package.json` + `package-lock.json`, runs `npm ci`, copies source (`src/`, `bin/`, `tsconfig.json`), runs `npm run build`.
2. **Run stage:** Node 22 slim base, copies `package.json` + `package-lock.json`, runs `npm ci --omit=dev`, copies `dist/` from build stage, `WORKDIR /app`, entrypoint `node dist/bin/token-toll.js`.

Note: `l402-mcp` is a `file:` dev dependency that won't exist in the Docker context. Since `--omit=dev` skips it, this is fine — but if `npm ci` fails due to strict lockfile validation, the deploy script should use `npm install --omit=dev` instead.

The image does not bundle Ollama — that runs as a separate container.

## .dockerignore

Excludes: `node_modules`, `test/`, `*.test.ts`, `.git`, `docs/`, `deploy/`, `*.md` (except `LICENSE`), `.env`, `.env.*`.

## Environment variables

All configuration via env vars (no config file):

| Variable | Value | Notes |
|----------|-------|-------|
| `UPSTREAM_URL` | `http://localhost:11434` | Ollama on host network |
| `LIGHTNING_BACKEND` | `phoenixd` | Shared Phoenixd node |
| `LIGHTNING_URL` | `http://localhost:9740` | Phoenixd on host network |
| `LIGHTNING_KEY` | `<from phoenix.conf>` | Read from Phoenixd container at deploy time |
| `PORT` | `3002` | Avoids conflict with 3000/3001 |
| `ROOT_KEY` | `<generated once>` | Persisted in deploy script or env file |
| `TOKEN_TOLL_TOKEN_PRICE` | `1` | 1 sat per 1k tokens (demo pricing) |
| `TOKEN_TOLL_MODEL_PRICE` | `qwen3:0.6b:2` | Model-specific rate to showcase feature |
| `FREE_TIER_REQUESTS` | `10` | Let people try before paying |
| `STORAGE` | `sqlite` | Persist credits across restarts |
| `TOKEN_TOLL_DB_PATH` | `./data/token-toll.db` | Relative to WORKDIR `/app`, volume at `/app/data` |
| `TUNNEL` | `false` | No tunnel on headless VPS |

Auth mode is inferred as `lightning` from `LIGHTNING_BACKEND=phoenixd`. Combined with `FREE_TIER_REQUESTS=10`, the first 10 requests per IP per day are free, then Lightning payment is required.

## Ollama setup

The Ollama container:
- Uses `ollama/ollama:latest` image
- Runs with `--network host` and `OLLAMA_HOST=127.0.0.1:11434` (binds to localhost only, not publicly accessible)
- Volume: `/opt/ollama/models:/root/.ollama` for model persistence
- After first start, pull the model: `docker exec ollama ollama pull qwen3:0.6b`
- Restart policy: `--restart always`

## Deploy script

`deploy/hetzner.sh` — a bash script run from the local machine that:

1. Reads the Phoenixd password from the running container (`docker exec routing-phoenixd-1 cat /phoenix/.phoenix/phoenix.conf`)
2. Copies the repo to the VPS via rsync (or git pull if already cloned)
3. Builds the `token-toll` Docker image on the VPS
4. Ensures the Ollama container is running; pulls the model if needed
5. Stops/removes the old `token-toll` container if running
6. Starts the new `token-toll` container with env vars
7. Waits for health check (`curl localhost:3002/health`)

The script uses the existing SSH access: `ssh deploy@REDACTED_IP` with `~/.ssh/id_ed25519`.

### Root key persistence

The deploy script generates a root key on first deploy and stores it in `/opt/token-toll/.env` on the VPS. Subsequent deploys read from this file. This matches the pattern used by other services.

### Data volume

Token-toll's SQLite database is stored in a host-mounted volume at `/opt/token-toll/data/` mapped to `/app/data` in the container (relative to `WORKDIR /app`).

### Container restart policy

Both `ollama` and `token-toll` containers use `--restart always`.

## File changes

| File | Change |
|------|--------|
| `Dockerfile` | New — multi-stage Node 22 build |
| `.dockerignore` | New — exclude dev files from Docker context |
| `deploy/hetzner.sh` | New — deployment script |

No changes to any existing source files.

## Out of scope

- Reverse proxy / TLS (Cloudflare Tunnel or nginx can be added later)
- CI/CD automation (manual deploy for now)
- Multiple model support (just qwen3:0.6b for the demo)
- Monitoring / alerting
