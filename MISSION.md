# Mission

**satgate exists to let anyone monetise any OpenAI-compatible AI endpoint in seconds — pay-per-token, any payment rail, no accounts, no middlemen.**

Running AI inference costs real money — whether it's your own GPU, a cloud instance, or a hosted endpoint. But the tools for selling access are stuck in the Stripe era: sign-up forms, API key management, billing dashboards, subscription tiers. None of it works for machines. None of it settles instantly. None of it is permissionless.

satgate sits in front of any OpenAI-compatible backend — Ollama, vLLM, llama.cpp, or any other — and handles the rest. Clients pay per token. The payment settles before the response finishes streaming. The operator earns from the first request.

satgate is built on [toll-booth](https://github.com/TheCryptoDonkey/toll-booth), the payment-rail agnostic L402 middleware. On the client side, [402-mcp](https://github.com/TheCryptoDonkey/402-mcp) gives AI agents the ability to discover satgate endpoints, purchase credits, and consume inference autonomously. The full stack: any backend can charge, any agent can pay.

We believe:

- **Payment rails are pluggable, not tribal.** Lightning, Cashu, NWC today. x402 stablecoins tomorrow. The operator picks what to accept. The client picks what to pay with. satgate doesn't care — it just counts tokens and settles the bill.
- **The product layer matters.** Neither L402 nor x402 know what a token is. They're payment protocols. satgate adds the AI-specific concerns: token counting, model pricing, capacity management, streaming support, cost reconciliation. Payment protocols move money. satgate is the product.
- **Inference should be a vending machine.** No accounts. No API keys. No billing portal. Hit the endpoint, pay the price, get the completion. Machines and humans alike.
- **Operators deserve fairness.** Estimated charges upfront, actual token counts after. Overpayments credited back. Operators are never short-changed.
- **Privacy by design.** No personal data collected or stored. No IP logging. GDPR-safe out of the box.
- **Simplicity wins.** `npx satgate --upstream http://localhost:11434` — that's the whole setup. If it's harder than that, we failed.
