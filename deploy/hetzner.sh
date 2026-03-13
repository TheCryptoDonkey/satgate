#!/usr/bin/env bash
set -euo pipefail

# --- Configuration ---
VPS_HOST="${VPS_HOST:?Set VPS_HOST environment variable}"
VPS_USER="${VPS_USER:-deploy}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH_CMD="ssh -o IdentityFile=$SSH_KEY -o IdentitiesOnly=yes $VPS_USER@$VPS_HOST"
REMOTE_DIR="/opt/satgate"
CONTAINER_NAME="satgate"
OLLAMA_CONTAINER="ollama"
OLLAMA_MODEL="qwen3:0.6b"
PORT=3002

echo "=== satgate deploy ==="

# --- Step 1: Rsync repo to VPS ---
echo "[1/6] Syncing repo to VPS..."
$SSH_CMD "mkdir -p $REMOTE_DIR/src"
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
$SSH_CMD "cd $REMOTE_DIR/src && docker build -t satgate:latest ."

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

# --- Step 6: Deploy satgate container ---
echo "[6/6] Deploying satgate container..."

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
  -e SATGATE_TOKEN_PRICE=1 \
  -e 'SATGATE_MODEL_PRICE=$OLLAMA_MODEL:2' \
  -e FREE_TIER_REQUESTS=10 \
  -e STORAGE=sqlite \
  -e SATGATE_DB_PATH=./data/satgate.db \
  -e TUNNEL=false \
  satgate:latest"

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
