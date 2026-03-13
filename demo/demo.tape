# token-toll VHS demo
# Each scene clears the screen for maximum legibility at small sizes.
#
# Run:  cd token-toll && vhs demo/demo.tape

Output "demo/token-toll-demo.gif"

Require bash
Require curl
Require jq

Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 600
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 24
Set PlaybackSpeed 1

# Hidden: set up PATH and cd
Hide
Type `export PATH="/Users/darren/.nvm/versions/node/v22.17.0/bin:$PATH"`
Enter
Type "cd /Users/darren/WebstormProjects/token-toll && clear"
Enter
Sleep 1s
Show

# ── Scene 1: Boot the server ──────────────────────────────────────────────────
Type "npx tsx demo/demo.ts &"
Enter
Sleep 5s

# ── Scene 2: Free request ────────────────────────────────────────────────────
Hide
Type "clear"
Enter
Sleep 300ms
Show

Type `curl -s -H "Content-Type: application/json" localhost:3000/v1/chat/completions -d @demo/prompt.json | jq .choices[0].message.content`
Enter
Sleep 4s

Hide
Type "echo ''"
Enter
Show
Type "echo '# Free tier — no payment needed'"
Enter
Sleep 3s

# ── Scene 3: 402 Payment Required ────────────────────────────────────────────
Hide
Type "clear"
Enter
Sleep 300ms
Show

Type `curl -s -w '\nHTTP %{http_code}\n' -o /dev/null -H "Content-Type: application/json" localhost:3000/v1/chat/completions -d @demo/prompt.json`
Enter
Sleep 2s

Hide
Type "echo ''"
Enter
Show
Type "echo '# Free tier exhausted — 402 Payment Required'"
Enter
Sleep 3s

# ── Scene 4: Paid request ────────────────────────────────────────────────────

# Hidden: create invoice, wait for auto-settle, extract credentials
Hide
Type "curl -s -X POST localhost:3000/create-invoice > /tmp/inv.json"
Enter
Sleep 1s
Type `MAC=$(jq -r .macaroon /tmp/inv.json)`
Enter
Type `PURL=$(jq -r .payment_url /tmp/inv.json)`
Enter
Type `PRE=$(curl -s "localhost:3000$PURL" | jq -r .preimage)`
Enter
Sleep 500ms
Type "clear"
Enter
Sleep 300ms
Show

Type `curl -s -H "Authorization: L402 $MAC:$PRE" -H "Content-Type: application/json" localhost:3000/v1/chat/completions -d @demo/prompt.json | jq .choices[0].message.content`
Enter
Sleep 4s

Hide
Type "echo ''"
Enter
Show
Type "echo '# Paid with Lightning — 1 sat per 1k tokens'"
Enter
Sleep 4s

# Clean up
Hide
Type "kill %1 2>/dev/null"
Enter
Show

Sleep 500ms
