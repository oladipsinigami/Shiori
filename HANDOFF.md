# Shiori — Session Handoff

## Latest rejection (same two reasons)

OKX rejected agent **Shiori (#5001)** again:

1. **x402 standard validation** — must integrate via **OKX Payment SDK**  
   Guide: https://web3.okx.com/onchainos/dev-docs/okxai/howtokmcp  
   Official seller reference (reachable when docs DNS is blocked):  
   https://raw.githubusercontent.com/okx/payments/master/typescript/SELLER.md

2. **Agent timeout** — platform got no XMTP response (stale okx-a2a daemon lock).

## Fixes in this workspace (deploy before resubmit)

### No.1 — OKX Payment SDK on `POST /chat`

- `okx-payment.js` — `OKXFacilitatorClient` + `ExactEvmScheme` + `paymentMiddlewareFromHTTPServer`
- `server.js` — Express app; public unpaid `/chat` goes through the SDK (standard 402)
- Loopback / `X-Shiori-Internal-Key` bypass so okx-a2a → shim still reaches the brain without paying
- Official asset: **USD₮0** `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` on `eip155:196`, price `$0.01`

**Required env on Render + Railway (brain):**

```
OKX_API_KEY=...
OKX_SECRET_KEY=...          # or OKX_API_SECRET
OKX_PASSPHRASE=...
PAY_TO=0xa2fbc18fd6306d84566f85edd6912fc8f91af33c   # optional; defaults to Shiori wallet
```

Without those keys, public `/chat` returns **503** (not a valid 402) — set them before resubmit.

### No.2 — Stale daemon lock

- `scripts/railway-a2a-worker.js` — `clearStaleDaemonLock()` at boot
- Commit + push so Railway redeploys
- Confirm logs: `cleared stale daemon lock` and/or daemon starts listeners (not 2300× "another daemon is already running")

## Deploy checklist

1. Set OKX SA API credentials on Render and Railway.
2. Commit + push: `okx-payment.js`, `server.js`, `package.json`, `package-lock.json`, `scripts/railway-a2a-worker.js`, `scripts/shiori-claude-shim.js`, `public/app.js`.
3. Verify unpaid: `POST https://<public>/chat` → **402** with SDK-shaped `accepts` / `PAYMENT-REQUIRED` (not hand-rolled only).
4. Railway logs: daemon lock cleared, XMTP up; OKX dashboard agent **Online**.
5. Manual: as OKX.AI user, “I would like to use the services of agent ID 5001”.
6. Resubmit via chat.

## Hosts

- **Render** `https://shiori-h45s.onrender.com` — public brain (`PUBLIC_BASE_URL`)
- **Railway** — `railway-start.js` = brain + a2a worker; worker uses `SHIORI_URL=http://127.0.0.1:$PORT` in-container (internal free path)
