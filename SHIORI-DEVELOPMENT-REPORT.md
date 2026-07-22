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
| 5th | ❌ Rejected | **Two reasons.** No.1: x402 standard validation — OKX asked us to integrate x402 using the OKX Payment SDK (see §4/§10). No.2: platform testing could not get any response from the agent → task timed out. Root cause of No.2 diagnosed: a stale okx-a2a daemon lock on the persistent volume stopped the XMTP listener from ever starting (see §10) |
| 6th | 🔄 Ready to submit | Stale-lock fix applied to `railway-a2a-worker.js` (auto-clears the lock on boot so the XMTP daemon starts); live 402 re-confirmed spec-clean against the deployed endpoint |
| 7th | 🔄 Ready to submit | OKX Payment SDK integrated (`@okxweb3/x402-express` dual-path: SDK exact scheme when keys present, charge fallback otherwise). A2MCP `/a2mcp/invoke` now returns 402 (was timing out on review). Railway running SDK mode (sdkMode:true). |

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
      "asset": "0x779Ded0c9e1022225f8E0630b35a9b54bE713736",
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
- USDT contract: `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` (SDK-canonical USD₮0, 6 decimals)
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

## 8. Current Status & Remaining Items

### ✅ Verified (7th-attempt-ready)

| Check | Result |
|---|---|
| Render `/health` | ✅ OK — x402 charge mode |
| Render `/chat` (unpaid) | ✅ **402** — SDK-canonical USDT0 challenge |
| Render `/a2mcp/invoke` (unpaid) | ✅ **402** — same challenge, no timeout |
| Render `/a2mcp/tools` | ✅ `media_recommendations` tool |
| Render `/.well-known/agent.json` | ✅ Agent card with pricing, wallet, skills |
| Render A2A JSON-RPC | ✅ agent/card + tasks/send both respond |
| Railway `/health` | ✅ **sdkMode:true** (SDK exact scheme active) |
| Stale-lock fix | ✅ Code in `railway-a2a-worker.js` + pushed to `master` so Railway auto-deploys it |

### ❓ Needs confirmation (not externally testable)

- [ ] **A2A daemon actually started** — check Railway logs for `daemon lock acquired` + `listener` lines. Requires Railway CLI or dashboard access.
- [ ] **Manual smoke test** — on OKX.AI marketplace, prompt agent #5001 and confirm a response comes back (tests both XMTP delivery AND x402 payment flow end-to-end).
- [ ] **OKX dashboard shows Online** — agent #5001 should flip to green status if the daemon heartbeats are reaching the platform.

### 📋 To do

- [ ] **Re-submit ASP listing** — 7th attempt, once daemon is confirmed online
- [ ] **Delete `railway-identity.env`** — local gitignored file holding base64 identity secrets; Railway already has the vars set, so it can be removed

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

---

## 10. Issues Faced & Resolved

A running log of the significant problems hit during development and how each was
diagnosed and fixed.

### 10.1 x402 402 challenge non-conformant (rejections 3–4) — RESOLVED

**Symptom:** OKX rejected the listing for "x402 standard validation": the unpaid
`/chat` request did not return a standard 402 challenge.

**Root cause:** the 402 body was non-conformant with the x402 v1 spec —
`x402Version` was sent as the string `"1"` instead of the number `1`, the challenge
was nested under a `payment` key instead of being the top-level body, and the
`accepts[]` entry was missing required fields (`resource`, `description`,
`maxTimeoutSeconds`).

**Fix:** rebuilt the challenge in `x402.js` to the canonical v1 shape (numeric
`x402Version`, top-level `error`, complete `accepts[]`), and added the
`WWW-Authenticate: Payment` charge header plus `Access-Control-Expose-Headers` so
browser clients can read the payment headers. Verified against the live endpoint —
`POST /chat` (unpaid) now returns a spec-clean `402` with all required fields. See §4.

### 10.2 Agent unreachable / task timeout — stale daemon lock (rejection 5, No.2) — RESOLVED (fix pending deploy)

**Symptom:** during OKX platform testing the agent returned no response at all and the
task timed out. This was the more serious of the two 5th-attempt rejections — the
payment challenge is never even exercised if the platform can't reach the agent.

**Investigation:** the OKX.AI marketplace delivers tasks to agents over **XMTP via the
okx-a2a daemon**, not by calling the HTTP endpoint (online status comes from okx-a2a
heartbeats, not from HTTP health). The Railway service `shiori-a2a-worker` was Online,
on Node 22, with the OnchainOS identity correctly set — everything looked healthy. But
the `railway logs` told the real story: the daemon had tried to start **2,300+ times**,
each attempt exiting instantly with:

```
[okx-agent-task] another daemon is already running for home=/data/okx-agent-task; exiting before starting listeners
```

**Root cause:** okx-a2a writes a lock at `/data/okx-agent-task/run/daemon.lock/owner.json`.
It decides the lock is held if the pid recorded inside is alive (`process.kill(pid, 0)`).
That lock lives on the **persistent `/data` volume** and survives container restarts, but
pids reset every container (they start from 1). So the old, dead daemon's pid gets reused
by an unrelated process in the new container, the liveness check returns true, the lock
looks permanently "held," and the daemon exits **before ever opening its XMTP listeners**.
No listener → the marketplace's task reaches nothing → timeout.

**Fix:** added `clearStaleDaemonLock()` to `scripts/railway-a2a-worker.js`, called once at
worker boot (after identity bootstrap, before `startOkxA2a()`) to remove the lock
directory and stale `listener.pid`. It runs before any daemon the worker manages is
started, so it can never delete a live daemon's lock. The fix was committed to `master`
and Railway auto-deploys from `master`, so it is live. **Confirmation** requires
checking Railway logs for `cleared stale daemon lock artifact` and
`daemon lock acquired` lines — these would be the first sign the XMTP listener
ever started successfully.

### 10.3 Deployment/documentation drift (Render vs Railway) — RESOLVED

**Symptom:** the report described Railway (Docker + `/data` volume + A2A worker) as the
active host, but the public agent URL was on Render (`shiori-h45s.onrender.com`) running
`server.js` only, with no A2A worker and no `@okxweb3/a2a-node` dependency in
`package.json`. This drift initially masked where the timeout was actually coming from.

**Clarified reality:** both hosts are live and each has a distinct role —
- **Render (`shiori-h45s.onrender.com`)** serves the HTTP brain: public website, `/chat`
  (x402-gated), `/health`, and the A2A/A2MCP HTTP routes. This is what `PUBLIC_BASE_URL`
  points at and what x402 validators hit.
- **Railway (`shiori-a2a-worker-production.up.railway.app`)** runs the always-on okx-a2a
  XMTP worker that keeps the marketplace listing reachable, plus its own copy of the
  brain; it reaches the HTTP brain over `SHIORI_URL`.

The worker's `/health` returns `"a2a": true`, but that is a **static flag** meaning "the
HTTP A2A routes exist" — it does **not** indicate the XMTP daemon is actually running.
Daemon liveness must be confirmed from `railway logs`, not from `/health`.

### 10.4 OKX identity — already provisioned, no regeneration needed — RESOLVED

**Concern:** it was unclear whether the OKX agent identity (session + wallet keys) still
existed or needed to be regenerated via the onboarding CLI.

**Finding:** the identity already exists locally at `~/.onchainos/` (`session.json` +
`wallets.json`), pinned to Shiori account `c08d7adc-…`, with the session key valid until
**2026-10-23** (~95 days out at time of check). The same base64 values are already set on
Railway as `ONCHAINOS_SESSION_B64` / `ONCHAINOS_WALLETS_B64`. No regeneration required.
The identity is restored onto the volume at boot by `scripts/bootstrap-identity.js`.

### 10.5 okx-a2a requires Node 22 (`node:sqlite`) — RESOLVED

**Symptom:** running `okx-a2a` locally failed with
`Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite`.

**Root cause:** okx-a2a depends on the built-in `node:sqlite` module, which only exists in
**Node 22+**. The local machine was on Node v20.20.2.

**Fix:** the daemon runs in the Railway container, which is pinned to
`node:22-bookworm-slim` in the `Dockerfile`, so the runtime requirement is met in
production. Local invocation of the daemon on Node 20 is not needed.

### 10.6 Render free-tier cold start — MITIGATION IDENTIFIED

**Symptom:** the first hit to the Render brain after idle returned blank/slow (`/health`
empty on first request, then `200` on retry ~30s later).

**Root cause:** Render's free tier spins the service down after ~15 min idle; the next
request pays a cold-start penalty that can exceed a reviewer's timeout window.

**Mitigation:** keep the service warm with a periodic `/health` ping (e.g. UptimeRobot
every 5 min) during review. Note this is secondary to §10.2 — the marketplace timeout was
driven by the XMTP daemon not listening, not by Render cold start.

### 10.7 OKX Payment SDK integration (rejection 6, No.1) — RESOLVED

**Symptom:** the 5th rejection asked for integration via the **OKX Payment SDK**
(`@okxweb3/x402-express` + `ExactEvmScheme`) instead of the hand-rolled charge model.

**Root cause:** the listing validator was checking for SDK-specific x402 formatting; a
hand-rolled spec-clean 402 was still flagged as non-conformant.

**Fix:** created `okx-payment.js` with a dual-path architecture:
- **SDK exact scheme** (when `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` set):
  uses `@okxweb3/x402-express` middleware, `OKXFacilitatorClient`, `ExactEvmScheme`,
  `x402HTTPResourceServer`. Verified via OKX SA API (EIP-3009 gasless).
- **Charge-model fallback** (when SA keys missing): inline `buildChargeMiddleware()`
  returns standard x402 v1 challenge. Paid requests verified on-chain via RPC receipt
  in `x402.js`.

Both `/chat` and `/a2mcp/invoke` are gated. Railway has the SA keys set → runs SDK mode
(`sdkMode:true`). Render runs charge fallback (`sdkMode:false`). The A2MCP endpoint
previously returned `200` (causing review timeout); now returns instant `402`.

**SDK packages installed:**
```
@okxweb3/x402-core@0.1.0
@okxweb3/x402-evm@0.2.1
@okxweb3/x402-express@0.1.1
```

**Verification:** `POST /a2mcp/invoke` (unpaid) returns HTTP 402 with
SDK-canonical USDT0 (`0x779Ded0c9e1022225f8E0630b35a9b54bE713736`), correct
`payTo`, `network: eip155:196`, `maxAmountRequired: 10000`.
