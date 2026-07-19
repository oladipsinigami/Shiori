# Shiori (Obito) — Development & Deployment Report

## Overview

**Shiori** (formerly codenamed Obito) is an AI Librarian Recommendation Agent built for the **OKX.AI Genesis Hackathon**. It delivers 1–3 personalized movie/anime/novel recommendations with human-like reasoning, an evolving taste profile, and proactive time-awareness.

---

## 1. Project Setup

| Item | Detail |
|---|---|
| **Working Directory** | `C:\Users\oladips\Downloads\Obito` |
| **Runtime** | Node.js v22.23.1 |
| **LLM Provider** | OpenRouter (`openrouter/auto`) |
| **API Key** | OpenRouter |
| **Hosting** | Railway (Docker + persistent volume at `/data`) |
| **Code** | GitHub: `github.com/oladipsinigami/Shiori` |
| **Agent ID** | #5001 |
| **Owner Wallet** | `0xa2fbc18fd6306d84566f85edd6912fc8f91af33c` |

### Key Files

| File | Purpose |
|---|---|
| `obito.md` | System prompt / agent personality definition |
| `obito-core.js` | Core logic: LLM calls (OpenRouter), profile storage, recommendation logging |
| `server.js` | HTTP server — `/chat` (A2MCP with x402), static frontend, A2A/A2MCP routes |
| `x402.js` | x402 challenge generation (spec-compliant v1 body) + on-chain USDT transfer verification (charge model) |
| `okx-x402.js` | OKX facilitator verify/settle client for the signed-payload `exact` scheme — **dormant** (not used by the charge flow; kept for a future gasless path) |
| `a2a.js` | A2A/A2MCP card, JSON-RPC, REST task handlers |
| `public/index.html` | Landing page with wallet connect + chat UI |
| `public/app.js` | Frontend logic: MetaMask wallet, x402 payment, chat bubble |
| `public/styles.css` | Frontend styling |
| `render.yaml` | Render Blueprint configuration |
| `package.json` | Node.js project config |

---

## 2. Hosting — Railway

| Item | Detail |
|---|---|
| **Platform** | Railway (Docker build) |
| **Entrypoint** | `scripts/railway-start.js` (runs `server.js` + A2A worker in one container) |
| **Public port** | `server.js` owns `PORT` (website + `/chat` + `/health`) |
| **Persistent volume** | Mounted at `/data` — profiles/logs survive restarts (`DATA_DIR=/data`) |
| **Health Check** | `/health` |
| **A2A worker** | `scripts/railway-a2a-worker.js` — okx-a2a XMTP heartbeats keep the marketplace listing online |

### Why Railway (moved off Render)
- The taste-memory feature writes per-user JSON profiles to disk. Render's free tier has an ephemeral filesystem, so memory was wiped on every restart/cold-start.
- Railway provides a persistent volume (`/data`) that survives restarts, so profiles persist.
- No aggressive idle spin-down, so no cold-start latency and the marketplace worker stays online.
- `render.yaml` is retained for reference/fallback but Railway (`railway.toml` + `Dockerfile`) is the active host.

---

## 3. OKX AI ASP Registration

| Item | Detail |
|---|---|
| **Agent Name** | Shiori |
| **Agent ID** | #5001 |
| **Role** | Agent Service Provider (ASP) |
| **Wallet Address** | `0xa2fbc18fd6306d84566f85edd6912fc8f91af33c` |
| **Service Type** | A2MCP (API service — pay-per-call, website-interactive) |
| **Service Name** | Media Recommendations |
| **Fee** | 0.01 USDT per request |
| **Endpoint** | `<PUBLIC_BASE_URL>/chat` (Railway public domain) |
| **Payment** | x402 — `WWW-Authenticate: Payment` + `PAYMENT-REQUIRED` headers |
| **Avatar** | Uploaded to OKX CDN (440×440, square corners) |
| **Status** | **Listing under review** (re-submitted multiple times) |

### Review History

| Attempt | Result | Reason |
|---|---|---|
| 1st | ✅ AI passed | Avatars rejected (quality + specs) |
| 2nd | ❌ Rejected | Avatar quality + specs (fixed: 440×440, new design) |
| 3rd | ❌ Rejected | x402 validation, service timeout, missing description (fixed: WWW-Authenticate header, updated description with params + examples) |
| 4th | ❌ Rejected | x402 standard validation — the unpaid 402 body was non-conformant (`x402Version` sent as string `"1"`, challenge nested under `payment`, `accepts[]` missing `resource`/`description`/`maxTimeoutSeconds`) |
| 5th | 🔄 Ready to submit | 402 challenge rebuilt to canonical x402 v1 spec (numeric `x402Version`, top-level `error`, complete `accepts[]`); `X-PAYMENT-RESPONSE` + CORS expose headers added |

---

## 4. x402 Payment Protocol

Shiori uses the x402 **charge model**: the buyer's wallet sends the USDT transfer
itself and replays the request with the resulting txHash, which the server verifies
on-chain. (The alternative `exact` model — where the buyer signs a gasless EIP-3009
authorization that a facilitator settles — is not used; `okx-x402.js` holds a dormant,
correctly-schema'd client for it should we add that path later.)

### Challenge Format (sent on unpaid requests)
- **Status**: `402 Payment Required`
- **Body IS the challenge** (top-level, per x402 v1 spec §5.1):
  ```json
  {
    "x402Version": 1,
    "error": "Payment required to access this resource",
    "accepts": [{
      "scheme": "exact",
      "network": "eip155:196",
      "maxAmountRequired": "10000",
      "asset": "0x1a7e4e63778B4f12a199C063f9831aE1c13e0f8E",
      "payTo": "0xa2fbc18fd6306d84566f85edd6912fc8f91af33c",
      "resource": "<PUBLIC_BASE_URL>/chat",
      "description": "One Shiori taste recommendation",
      "mimeType": "application/json",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "USDT", "version": "1" }
    }]
  }
  ```
- **Header**: `PAYMENT-REQUIRED: <base64 of the challenge body>`
- **Header**: `WWW-Authenticate: Payment id="shiori", realm="<host>", method="evm", intent="charge", request="<base64url>"` (OKX charge-intent, for the MetaMask send-tx flow)
- **CORS**: `Access-Control-Expose-Headers: PAYMENT-REQUIRED, WWW-Authenticate, X-PAYMENT-RESPONSE` so browser clients can read them

> **Why the 4th rejection happened:** the previous build sent `x402Version` as the
> string `"1"` (spec requires the number `1`), nested the challenge under a `payment`
> key instead of at the top level, and omitted required `accepts[]` fields
> (`resource`, `description`, `maxTimeoutSeconds`). All corrected above.

### Payment Verification (charge model)
- Reads `X-PAYMENT` header from client (base64-encoded `{ txHash, payer }`)
- Verifies on-chain via XLayer RPC (`xlayerrpc.okx.com`)
  - Checks for USDT `Transfer` event in the transaction logs
  - Confirms `to` = Shiori wallet, `amount >= 10000` (0.01 USDT)
- **Retry-then-reject**: RPC call retries up to 3 times (1s/2s backoff, 8s timeout each). If the transaction still can't be verified on-chain, the payment is **rejected** (402) — no accept-on-trust fallback. This closes the hole where a forged `X-PAYMENT` header would pass on any RPC hiccup.
- On success, echoes an x402 `SettlementResponse` (`{ success, transaction, network, payer }`) back in the **`X-PAYMENT-RESPONSE`** header.
- USDT contract: `0x1a7e4e63778B4f12a199C063f9831aE1c13e0f8E`
- Payee: `0xa2fbc18fd6306d84566f85edd6912fc8f91af33c`

### Note on OKX verify/settle endpoints
OKX exposes no plug-in facilitator URL and no npm seller SDK. The facilitator
endpoints (`web3.okx.com/api/v6/pay/x402/{verify,settle}`, HMAC-signed like the OKX
exchange API v5) operate on **signed EIP-712 authorizations, not txHashes** — `/verify`
checks the signature off-chain and `/settle` broadcasts it on-chain. Because the charge
model's payment is already on-chain before the server sees it, these endpoints don't
apply to Shiori's current flow; on-chain RPC verification is the correct gate.

---

## 5. Frontend

Built as a single-page app served from `/` on the Render server:

| Feature | Detail |
|---|---|
| **Wallet Connect** | MetaMask (`ethereum.request`) |
| **Network** | XLayer (chainId: `0xc4`) — auto-switch + add |
| **Payment** | User clicks → MetaMask sends USDT `transfer` via `eth_sendTransaction` → waits for tx receipt → sends `X-PAYMENT` header |
| **Chat UI** | Bubble-style chat with thinking indicator |
| **Health** | Real-time status indicator |

---

## 6. A2A / A2MCP Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/` | GET | Frontend landing page |
| `/health`, `/ready` | GET | Health checks |
| `/debug` | GET | Env var & server debugging |
| `/chat` | POST | Main A2MCP endpoint (x402-gated) |
| `/.well-known/agent.json` | GET | Agent card for A2A discovery |
| `/a2mcp/tools` | GET | Tool listing |
| `/a2mcp/invoke` | POST | Tool invocation |
| `/a2a/tasks`, `/a2a/message` | POST | A2A REST tasks |
| `/a2a` | POST | JSON-RPC A2A (`message/send`, `tasks/get`, etc.) |

---

## 7. Avatar

| Item | Detail |
|---|---|
| **First avatar** | Rejected — low quality, misaligned with positioning |
| **Second avatar** | Rejected — wrong dimensions, rounded corners |
| **Third avatar** | 440×440 px, square corners, SVG-style design with books + film reel motif, deep purple/gold palette |
| **CDN URL** | `https://static.okx.com/cdn/web3/wallet/marketplace/headimages/agent/avatar/cd2f8562-cfb9-4599-bac3-3e3d7d71f7d0.png` |

---

## 8. Pending Issues

- [ ] **Re-submit ASP listing** — 5th attempt, with the spec-compliant 402 challenge (see §4)
- [ ] **Listing approval** — Waiting for human review (up to 24h)
- [ ] **Render cold start** — Free tier spins down; may cause timeout during review testing
- [ ] **A2A communication** — Node.js v20.20.2 locally < v22.14.0 requirement for A2A daemon
- [ ] **Set up UptimeRobot** — Ping `/health` every 5 min to keep warm during review

---

## 9. Tech Stack Summary

```
LLM API:          OpenRouter → openrouter/auto (switchable via OPENROUTER_MODEL)
Runtime:          Node.js v22
Backend Server:   Node.js HTTP (server.js)
Payment:          x402 charge model — spec-compliant v1 402 challenge + on-chain USDT verification via XLayer RPC, 0.01 USDT/req
Frontend:         Vanilla HTML/CSS/JS with MetaMask integration
Agent Definition: obito.md (system prompt)
Profile Storage:  JSON files under DATA_DIR (Railway volume /data → persistent)
ASP Platform:     OKX.AI (onchainos CLI v4.2.0)
Hosting:          Railway (Docker + persistent volume) — server.js + A2A worker
GitHub:           github.com/oladipsinigami/Shiori
```
