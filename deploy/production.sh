#!/usr/bin/env bash
set -euo pipefail

umask 077

SOURCE_REPO="${SOURCE_REPO:-/opt/satgate/src}"
RUNTIME_DIR="${RUNTIME_DIR:-/opt/satgate}"
CONFIG_FILE="${CONFIG_FILE:-$RUNTIME_DIR/deploy.conf}"
CONTAINER_NAME="${CONTAINER_NAME:-satgate}"
PHOENIXD_CONTAINER="${PHOENIXD_CONTAINER:-routing-phoenixd-1}"
OLLAMA_CONTAINER="${OLLAMA_CONTAINER:-ollama}"
DEPLOY_REF="${DEPLOY_REF:?DEPLOY_REF must be an exact vMAJOR.MINOR.PATCH release tag}"

if [[ ! "$DEPLOY_REF" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Refusing invalid DEPLOY_REF: $DEPLOY_REF" >&2
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Missing deployment configuration: $CONFIG_FILE" >&2
  exit 1
fi

read_config() {
  local key="$1"
  sed -n "s/^${key}=//p" "$CONFIG_FILE" | tail -n 1
}

PUBLIC_URL="$(read_config PUBLIC_URL)"
ANNOUNCE_RELAYS="$(read_config ANNOUNCE_RELAYS)"
OLLAMA_MODELS="$(read_config OLLAMA_MODELS)"

if [[ ! "$PUBLIC_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$ ]]; then
  echo "PUBLIC_URL must be an HTTPS URL" >&2
  exit 1
fi
if [[ ! "$ANNOUNCE_RELAYS" =~ ^wss://[A-Za-z0-9./,:_-]+$ ]]; then
  echo "ANNOUNCE_RELAYS contains unsupported characters" >&2
  exit 1
fi
if [[ ! "$OLLAMA_MODELS" =~ ^[A-Za-z0-9._,:-]+$ ]]; then
  echo "OLLAMA_MODELS contains unsupported characters" >&2
  exit 1
fi

git -C "$SOURCE_REPO" fetch --force --tags origin
DEPLOY_COMMIT="$(git -C "$SOURCE_REPO" rev-parse --verify "refs/tags/$DEPLOY_REF^{commit}")"
RELEASE_DIR="$RUNTIME_DIR/releases/$DEPLOY_COMMIT"

install -d -m 700 "$RUNTIME_DIR/releases" "$RUNTIME_DIR/data"
if [[ -d "$RELEASE_DIR" ]]; then
  if [[ "$(git -C "$RELEASE_DIR" rev-parse HEAD)" != "$DEPLOY_COMMIT" ]] ||
     [[ -n "$(git -C "$RELEASE_DIR" status --porcelain)" ]]; then
    echo "Existing release worktree is not the requested clean commit" >&2
    exit 1
  fi
else
  git -C "$SOURCE_REPO" worktree add --detach "$RELEASE_DIR" "$DEPLOY_COMMIT"
fi

PHOENIXD_PASSWORD="$(
  docker exec "$PHOENIXD_CONTAINER" sh -c \
    "sed -n 's/^http-password=//p' /phoenix/.phoenix/phoenix.conf" |
    head -n 1 | tr -d '[:space:]'
)"
if [[ ! "$PHOENIXD_PASSWORD" =~ ^[A-Za-z0-9_-]{32,256}$ ]]; then
  echo "Could not read a valid Phoenixd password; refusing fallback" >&2
  exit 1
fi

ROOT_KEY_FILE="$RUNTIME_DIR/.root-key"
if [[ ! -f "$ROOT_KEY_FILE" ]]; then
  openssl rand -hex 32 >"$ROOT_KEY_FILE"
  chmod 600 "$ROOT_KEY_FILE"
fi
ROOT_KEY="$(tr -d '[:space:]' <"$ROOT_KEY_FILE")"
if [[ ! "$ROOT_KEY" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Invalid persisted macaroon root key" >&2
  exit 1
fi

ANNOUNCE_KEY_FILE="$RUNTIME_DIR/.announce-key"
if [[ ! -f "$ANNOUNCE_KEY_FILE" ]]; then
  openssl rand -hex 32 >"$ANNOUNCE_KEY_FILE"
  chmod 600 "$ANNOUNCE_KEY_FILE"
fi
ANNOUNCE_KEY="$(tr -d '[:space:]' <"$ANNOUNCE_KEY_FILE")"
if [[ ! "$ANNOUNCE_KEY" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Invalid persisted announcement key" >&2
  exit 1
fi

if ! docker container inspect "$OLLAMA_CONTAINER" >/dev/null 2>&1; then
  echo "Ollama is not provisioned; refusing a mutable implicit install" >&2
  exit 1
fi
IFS=',' read -r -a REQUIRED_MODELS <<<"$OLLAMA_MODELS"
for model in "${REQUIRED_MODELS[@]}"; do
  if ! docker exec "$OLLAMA_CONTAINER" ollama show "$model" >/dev/null 2>&1; then
    echo "Required Ollama model is not provisioned: $model" >&2
    exit 1
  fi
done

IMAGE_TAG="satgate:${DEPLOY_COMMIT}"
docker build \
  --label "org.opencontainers.image.revision=$DEPLOY_COMMIT" \
  --label "org.opencontainers.image.version=$DEPLOY_REF" \
  -t "$IMAGE_TAG" \
  "$RELEASE_DIR"

SATGATE_UID="$(docker run --rm "$IMAGE_TAG" id -u satgate)"
if [[ ! "$SATGATE_UID" =~ ^[0-9]+$ ]]; then
  echo "Could not determine the container user" >&2
  exit 1
fi
sudo chown -R "$SATGATE_UID:$SATGATE_UID" "$RUNTIME_DIR/data"

REALM="${PUBLIC_URL#https://}"
REALM="${REALM%%/*}"
ENV_FILE="$(mktemp "$RUNTIME_DIR/runtime.env.XXXXXX")"
trap 'rm -f "$ENV_FILE"' EXIT
{
  printf 'UPSTREAM_URL=http://127.0.0.1:11434\n'
  printf 'LIGHTNING_BACKEND=phoenixd\n'
  printf 'LIGHTNING_URL=http://127.0.0.1:9740\n'
  printf 'LIGHTNING_KEY=%s\n' "$PHOENIXD_PASSWORD"
  printf 'PORT=3002\n'
  printf 'ROOT_KEY=%s\n' "$ROOT_KEY"
  printf 'SATGATE_TOKEN_PRICE=5\n'
  printf 'SATGATE_MODEL_PRICE=qwen3:0.6b:10,gemma3:4b:30\n'
  printf 'SATGATE_ESTIMATED_COST=10\n'
  printf 'FREE_TIER_CREDITS=250\n'
  printf 'STORAGE=sqlite\n'
  printf 'SATGATE_DB_PATH=./data/satgate.db\n'
  printf 'SATGATE_REALM=%s\n' "$REALM"
  printf 'TUNNEL=false\n'
  printf 'ANNOUNCE=true\n'
  printf 'ANNOUNCE_KEY=%s\n' "$ANNOUNCE_KEY"
  printf 'ANNOUNCE_RELAYS=%s\n' "$ANNOUNCE_RELAYS"
  printf 'PUBLIC_URL=%s\n' "$PUBLIC_URL"
} >"$ENV_FILE"
chmod 600 "$ENV_FILE"

ROLLBACK_NAME="${CONTAINER_NAME}-rollback"
if docker container inspect "$ROLLBACK_NAME" >/dev/null 2>&1; then
  echo "Stale rollback container exists: $ROLLBACK_NAME" >&2
  exit 1
fi

HAD_PREVIOUS=0
if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  HAD_PREVIOUS=1
  docker stop "$CONTAINER_NAME"
  docker rename "$CONTAINER_NAME" "$ROLLBACK_NAME"
fi

rollback() {
  docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
  if [[ "$HAD_PREVIOUS" == "1" ]]; then
    docker rename "$ROLLBACK_NAME" "$CONTAINER_NAME"
    docker start "$CONTAINER_NAME"
  fi
}

if ! docker run -d \
  --name "$CONTAINER_NAME" \
  --network host \
  --restart always \
  --volume "$RUNTIME_DIR/data:/app/data" \
  --env-file "$ENV_FILE" \
  "$IMAGE_TAG"; then
  rollback
  exit 1
fi

healthy=0
for _ in $(seq 1 20); do
  if curl --fail --silent --show-error http://127.0.0.1:3002/health >/dev/null; then
    healthy=1
    break
  fi
  sleep 2
done

if [[ "$healthy" != "1" ]]; then
  docker logs --tail 50 "$CONTAINER_NAME" >&2 || true
  rollback
  exit 1
fi

if [[ "$HAD_PREVIOUS" == "1" ]]; then
  docker rm "$ROLLBACK_NAME"
fi
printf '%s\n' "$DEPLOY_COMMIT" >"$RUNTIME_DIR/deployed-commit"
printf '%s\n' "$DEPLOY_REF" >"$RUNTIME_DIR/deployed-version"
chmod 644 "$RUNTIME_DIR/deployed-commit" "$RUNTIME_DIR/deployed-version"
echo "Deployed $DEPLOY_REF at $DEPLOY_COMMIT"
