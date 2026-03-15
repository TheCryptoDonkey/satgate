#!/usr/bin/env bash
# Client examples — how to interact with a running satgate instance.
#
# Assumes satgate is running on localhost:3000 with a free tier enabled.
#
# Usage:
#   chmod +x examples/client.sh
#   ./examples/client.sh

set -euo pipefail

BASE_URL="${SATGATE_URL:-http://localhost:3000}"

echo "=== Discovery ==="
echo ""

echo "1. Check pricing and models (/.well-known/l402):"
curl -s "${BASE_URL}/.well-known/l402" | jq .
echo ""

echo "2. Machine-readable description (/llms.txt):"
curl -s "${BASE_URL}/llms.txt"
echo ""

echo "3. List available models (/v1/models):"
curl -s "${BASE_URL}/v1/models" | jq '.data[].id'
echo ""

echo "=== Inference ==="
echo ""

echo "4. Chat completion (within free tier):"
curl -s "${BASE_URL}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2:1b",
    "messages": [{"role": "user", "content": "What is Bitcoin in one sentence?"}]
  }' | jq '.choices[0].message.content'
echo ""

echo "5. Streaming chat completion:"
curl -sN "${BASE_URL}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2:1b",
    "messages": [{"role": "user", "content": "Count to 5"}],
    "stream": true
  }'
echo ""
