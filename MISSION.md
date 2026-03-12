# Mission

**token-toll exists to let anyone monetise AI inference in seconds — pay-per-token, any payment rail, no accounts, no middlemen.**

LLM inference costs real money — GPUs, electricity, bandwidth. But the tools for selling access are stuck in the Stripe era: sign-up forms, API key management, billing dashboards, subscription tiers. None of it works for machines. None of it settles instantly. None of it is permissionless.

token-toll sits in front of any OpenAI-compatible endpoint and handles the rest. Clients pay per token. The payment settles before the response finishes streaming. The operator earns from the first request.

We believe:

- **Payment rails are pluggable, not tribal.** Lightning, Cashu, NWC today. x402 stablecoins tomorrow. The operator picks what to accept. The client picks what to pay with. token-toll doesn't care — it just counts tokens and settles the bill.
- **The product layer matters.** Neither L402 nor x402 know what a token is. They're payment protocols. token-toll adds the AI-specific concerns: token counting, model pricing, capacity management, streaming support, cost reconciliation. Payment protocols move money. token-toll is the product.
- **Inference should be a vending machine.** No accounts. No API keys. No billing portal. Hit the endpoint, pay the price, get the completion. Machines and humans alike.
- **Operators deserve fairness.** Estimated charges upfront, actual token counts after. Overpayments credited back. Operators are never short-changed.
- **Simplicity wins.** `npx token-toll --upstream http://localhost:11434` — that's the whole setup. If it's harder than that, we failed.
