#!/usr/bin/env bash
# Basic satgate usage — monetise a local Ollama instance.
#
# Prerequisites:
#   - Ollama running on localhost:11434
#   - phoenixd running on localhost:9740, with its HTTP password exported as
#     LIGHTNING_KEY (or swap --lightning for lnbits, lnd, cln or nwc)
#   - Node.js >= 22
#
# Usage:
#   chmod +x examples/basic.sh
#   ./examples/basic.sh

set -euo pipefail

echo "Starting satgate in front of Ollama..."
echo ""

# Auto-detects models and charges per token over Lightning.
# Without --lightning, satgate runs in open mode: no payment, no auth,
# local only.
: "${LIGHTNING_KEY:?Set LIGHTNING_KEY to your phoenixd HTTP password}"
npx satgate --upstream http://localhost:11434 --lightning phoenixd
