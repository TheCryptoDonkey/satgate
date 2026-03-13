# Hetzner Deployment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy token-toll as a Docker service on the Hetzner VPS, proxying Ollama with Lightning payments via the shared Phoenixd node.

**Architecture:** Multi-stage Dockerfile builds token-toll from source. A deploy script rsync's the repo to the VPS, builds the image, starts Ollama + token-toll containers with host networking. All config via env vars.

**Tech Stack:** Docker, Node 22, bash, rsync, SSH

**Spec:** `docs/superpowers/specs/2026-03-13-hetzner-deployment-design.md`

**Server:** `REDACTED_IP`, SSH user `deploy`, key `~/.ssh/id_ed25519`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `Dockerfile` | Multi-stage build: compile TypeScript, produce slim production image |
| `.dockerignore` | Exclude dev/test files from Docker build context |
| `deploy/hetzner.sh` | End-to-end deployment script run from local machine |

No existing files are modified.

---

## Chunk 1: Docker + Deploy

### Task 1: Create .dockerignore

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Create the file**

```
node_modules
dist
test
*.test.ts
.git
.gitignore
docs
deploy
*.md
!LICENSE.md
.env
.env.*
.DS_Store
```

- [ ] **Step 2: Commit**

```bash
git add .dockerignore
git commit -m "chore: add .dockerignore"
```

---

### Task 2: Create Dockerfile

**Files:**
- Create: `Dockerfile`

The Dockerfile uses a multi-stage build. The build stage installs all dependencies (including dev) and compiles TypeScript. The run stage installs only production dependencies and copies the compiled output.

**Important:** The `l402-mcp` dev dependency uses `file:../l402-mcp` which won't resolve in Docker. The build stage needs `npm ci` for all deps (including dev, for TypeScript compiler). To handle the missing `file:` reference, the build stage uses `npm install` instead of `npm ci`, which is more tolerant of missing optional/file references. Alternatively, the Dockerfile can remove the problematic entry before installing.

- [ ] **Step 1: Create the Dockerfile**

```dockerfile
# Stage 1: Build
FROM node:22-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
# Remove file: dev dependency that won't resolve in Docker context
RUN node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); delete p.devDependencies['l402-mcp']; require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
COPY bin/ ./bin/
RUN npm run build

# Stage 2: Production
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); delete p.devDependencies; require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"
RUN npm install --omit=dev
COPY --from=build /build/dist/ ./dist/
EXPOSE 3002
CMD ["node", "dist/bin/token-toll.js"]
```

Note: We strip `devDependencies` entirely in the production stage and use `npm install --omit=dev` for a clean install. In the build stage we only remove the `l402-mcp` file reference so TypeScript and other dev tools are available.

- [ ] **Step 2: Test the Docker build locally**

Run: `docker build -t token-toll:test .`
Expected: Build succeeds. If it fails on `npm install` due to the lockfile, try `npm install --no-package-lock` in the build stage instead.

- [ ] **Step 3: Verify the image runs**

Run: `docker run --rm -e UPSTREAM_URL=http://host.docker.internal:11434 -e TUNNEL=false -p 3002:3002 token-toll:test`
Expected: Server starts (will fail to connect to upstream, but should not crash). Look for log output showing it's listening. Ctrl+C to stop.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "feat: add Dockerfile for production deployment"
```

---

### Task 3: Create deploy script

**Files:**
- Create: `deploy/hetzner.sh`

The deploy script is run from the local dev machine. It handles everything: rsync, Docker build, Ollama setup, and container management.

- [ ] **Step 1: Create the deploy directory**

```bash
mkdir -p deploy
```

- [ ] **Step 2: Create deploy/hetzner.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

# --- Configuration ---
VPS_HOST="REDACTED_IP"
VPS_USER="deploy"
SSH_KEY="$HOME/.ssh/id_ed25519"
SSH_CMD="ssh -o IdentityFile=$SSH_KEY -o IdentitiesOnly=yes $VPS_USER@$VPS_HOST"
REMOTE_DIR="/opt/token-toll"
CONTAINER_NAME="token-toll"
OLLAMA_CONTAINER="ollama"
OLLAMA_MODEL="qwen3:0.6b"
PORT=3002

echo "=== token-toll deploy ==="

# --- Step 1: Rsync repo to VPS ---
echo "[1/6] Syncing repo to VPS..."
rsync -az --delete \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=.git \
  --exclude=test \
  --exclude='*.test.ts' \
  -e "ssh -o IdentityFile=$SSH_KEY -o IdentitiesOnly=yes" \
  . "$VPS_USER@$VPS_HOST:$REMOTE_DIR/src/"

# --- Step 2: Read Phoenixd password ---
echo "[2/6] Reading Phoenixd password..."
PHOENIXD_PASSWORD=$($SSH_CMD "docker exec routing-phoenixd-1 cat /phoenix/.phoenix/phoenix.conf" \
  | grep 'http-password' | cut -d'=' -f2 | tr -d '[:space:]')
if [ -z "$PHOENIXD_PASSWORD" ]; then
  echo "ERROR: Could not read Phoenixd password"
  exit 1
fi

# --- Step 3: Ensure root key exists ---
echo "[3/6] Checking root key..."
$SSH_CMD "mkdir -p $REMOTE_DIR/data"
ROOT_KEY=$($SSH_CMD "cat $REMOTE_DIR/.root-key 2>/dev/null || true")
if [ -z "$ROOT_KEY" ]; then
  ROOT_KEY=$(openssl rand -hex 32)
  $SSH_CMD "echo '$ROOT_KEY' > $REMOTE_DIR/.root-key && chmod 600 $REMOTE_DIR/.root-key"
  echo "  Generated new root key"
else
  echo "  Using existing root key"
fi

# --- Step 4: Build Docker image ---
echo "[4/6] Building Docker image on VPS..."
$SSH_CMD "cd $REMOTE_DIR/src && docker build -t token-toll:latest ."

# --- Step 5: Ensure Ollama is running ---
echo "[5/6] Ensuring Ollama is running..."
OLLAMA_RUNNING=$($SSH_CMD "docker ps -q -f name=^${OLLAMA_CONTAINER}$" || true)
if [ -z "$OLLAMA_RUNNING" ]; then
  echo "  Starting Ollama..."
  $SSH_CMD "mkdir -p /opt/ollama/models && \
    docker run -d \
      --name $OLLAMA_CONTAINER \
      --network host \
      --restart always \
      -e OLLAMA_HOST=127.0.0.1:11434 \
      -v /opt/ollama/models:/root/.ollama \
      ollama/ollama:latest"
  echo "  Waiting for Ollama to start..."
  sleep 5
fi

# Pull model if not already present
echo "  Ensuring model $OLLAMA_MODEL is available..."
$SSH_CMD "docker exec $OLLAMA_CONTAINER ollama pull $OLLAMA_MODEL" || true

# --- Step 6: Deploy token-toll container ---
echo "[6/6] Deploying token-toll container..."

# Stop and remove existing container
$SSH_CMD "docker stop $CONTAINER_NAME 2>/dev/null && docker rm $CONTAINER_NAME 2>/dev/null || true"

# Start new container
$SSH_CMD "docker run -d \
  --name $CONTAINER_NAME \
  --network host \
  --restart always \
  -v $REMOTE_DIR/data:/app/data \
  -e UPSTREAM_URL=http://localhost:11434 \
  -e LIGHTNING_BACKEND=phoenixd \
  -e LIGHTNING_URL=http://localhost:9740 \
  -e LIGHTNING_KEY=$PHOENIXD_PASSWORD \
  -e PORT=$PORT \
  -e ROOT_KEY=$ROOT_KEY \
  -e TOKEN_TOLL_TOKEN_PRICE=1 \
  -e 'TOKEN_TOLL_MODEL_PRICE=$OLLAMA_MODEL:2' \
  -e FREE_TIER_REQUESTS=10 \
  -e STORAGE=sqlite \
  -e TOKEN_TOLL_DB_PATH=./data/token-toll.db \
  -e TUNNEL=false \
  token-toll:latest"

# Wait for health check
echo "Waiting for health check..."
for i in $(seq 1 15); do
  if $SSH_CMD "curl -s http://localhost:$PORT/health" > /dev/null 2>&1; then
    echo ""
    echo "=== Deployed! ==="
    $SSH_CMD "curl -s http://localhost:$PORT/health" | python3 -m json.tool 2>/dev/null || $SSH_CMD "curl -s http://localhost:$PORT/health"
    echo ""
    echo "Endpoints:"
    echo "  Health:     http://$VPS_HOST:$PORT/health"
    echo "  Discovery:  http://$VPS_HOST:$PORT/.well-known/l402"
    echo "  LLMs:       http://$VPS_HOST:$PORT/llms.txt"
    echo "  Models:     http://$VPS_HOST:$PORT/v1/models"
    exit 0
  fi
  sleep 2
done

echo "ERROR: Health check failed after 30s"
echo "Logs:"
$SSH_CMD "docker logs --tail 20 $CONTAINER_NAME"
exit 1
```

- [ ] **Step 3: Make executable**

```bash
chmod +x deploy/hetzner.sh
```

- [ ] **Step 4: Commit**

```bash
git add deploy/hetzner.sh
git commit -m "feat: add Hetzner deployment script"
```

---

### Task 4: Deploy to VPS

This task is manual — run the deploy script and verify the service is live.

- [ ] **Step 1: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Run the deploy script**

```bash
./deploy/hetzner.sh
```

Expected: Script completes with `=== Deployed! ===` and shows health check output.

- [ ] **Step 3: Verify endpoints**

```bash
# Health check
curl http://REDACTED_IP:3002/health

# Discovery
curl http://REDACTED_IP:3002/.well-known/l402

# LLMs.txt
curl http://REDACTED_IP:3002/llms.txt

# Models (proxied from Ollama)
curl http://REDACTED_IP:3002/v1/models
```

- [ ] **Step 4: Test a free-tier inference request**

```bash
curl -X POST http://REDACTED_IP:3002/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen3:0.6b", "messages": [{"role": "user", "content": "Say hello in one word"}]}'
```

Expected: Successful response with model output (free tier allows 10 requests/day).

- [ ] **Step 5: Verify Ollama is not publicly accessible**

```bash
curl http://REDACTED_IP:11434/v1/models
```

Expected: Connection refused (Ollama bound to 127.0.0.1 only).
