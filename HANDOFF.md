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

## Deploy progress (2026-07-21)

- [x] Code pushed to `master` (`f2655c6` SDK + lock fix; `d51c8bb` loopback SHIORI_URL)
- [x] Railway redeployed **SUCCESS** — Online
- [x] Stale lock clear confirmed in logs: `cleared stale daemon lock` + `daemon lock acquired pid=…`
- [ ] **OKX SA API keys** — still missing → public `/chat` returns **503** (not 402 yet)
- [ ] **OnchainOS session** — expired: `session expired, please login again: onchainos wallet login`  
  → XMTP `clients=0`, agent offline for marketplace even though daemon lock is fixed
- [ ] Render redeploy + same OKX keys on Render (`PUBLIC_BASE_URL`)
- [ ] Manual marketplace smoke test + resubmit

### Create OKX Payment API keys

1. Open **OKX Developer Portal**: https://web3.okx.com/onchain-os/dev-portal  
   (also linked from OnchainOS / payments docs)
2. Sign in with the same OKX account that owns agent #5001.
3. Create an **API key** for Onchain OS / SA API (read+trade style for payments if asked).  
   You get three values: **API Key**, **Secret Key**, **Passphrase**.
4. Give them to me (or set yourself), then we run:

```powershell
railway.cmd variables set OKX_API_KEY="..." OKX_SECRET_KEY="..." OKX_PASSPHRASE="..." PAY_TO="0xa2fbc18fd6306d84566f85edd6912fc8f91af33c"
```

Also add the same three vars on **Render** → Shiori service → Environment.

### Refresh OnchainOS session (marketplace Online)

Session on the volume is expired. On a machine with working `onchainos`:

```bash
onchainos wallet login
# then re-export base64 for Railway:
# ONCHAINOS_SESSION_B64 / ONCHAINOS_WALLETS_B64 from ~/.onchainos/
```

Or re-run local `scripts/bootstrap-identity.js` flow and update Railway vars, then redeploy/restart.

### Verify after keys

```text
POST /chat (unpaid) → 402 + PAYMENT-REQUIRED
GET  /health → x402.configured: true
railway logs → XMTP clients > 0, heartbeats, not "session expired"
```

## Hosts

- **Render** `https://shiori-h45s.onrender.com` — public brain (`PUBLIC_BASE_URL`)
- **Railway** — `railway-start.js` = brain + a2a worker; worker uses `SHIORI_URL=http://127.0.0.1:$PORT` in-container (internal free path)
