#!/usr/bin/env bash
# Basic satgate usage — monetise a local Ollama instance.
#
# Prerequisites:
#   - Ollama running on localhost:11434
#   - Node.js >= 22
#
# Usage:
#   chmod +x examples/basic.sh
#   ./examples/basic.sh

set -euo pipefail

echo "Starting satgate in front of Ollama..."
echo ""

# Start satgate with sensible defaults.
# This auto-detects models and begins accepting payments.
npx satgate --upstream http://localhost:11434
