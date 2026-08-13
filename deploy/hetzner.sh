#!/usr/bin/env bash
set -euo pipefail

VPS_HOST="${VPS_HOST:?Set VPS_HOST environment variable}"
VPS_USER="${VPS_USER:-deploy}"
SSH_KEY="${SSH_KEY:?Set SSH_KEY to the deployment private-key path}"
DEPLOY_REF="${DEPLOY_REF:?Set DEPLOY_REF to an exact vMAJOR.MINOR.PATCH release tag}"

if [[ ! "$DEPLOY_REF" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Refusing invalid DEPLOY_REF: $DEPLOY_REF" >&2
  exit 1
fi
if [[ ! -f "$SSH_KEY" ]]; then
  echo "SSH key not found: $SSH_KEY" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCTION_SCRIPT="$SCRIPT_DIR/production.sh"
REMOTE_STAGE="/tmp/satgate-deploy-${DEPLOY_REF}.sh"
REMOTE_TARGET="$VPS_USER@$VPS_HOST"
SSH_OPTIONS=(
  -o "IdentityFile=$SSH_KEY"
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
)

scp "${SSH_OPTIONS[@]}" "$PRODUCTION_SCRIPT" "$REMOTE_TARGET:$REMOTE_STAGE"
ssh "${SSH_OPTIONS[@]}" "$REMOTE_TARGET" \
  "install -m 755 '$REMOTE_STAGE' /opt/satgate/deploy.sh && rm -f '$REMOTE_STAGE' && DEPLOY_REF='$DEPLOY_REF' /opt/satgate/deploy.sh"
