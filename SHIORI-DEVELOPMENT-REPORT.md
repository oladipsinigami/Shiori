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

- [ ] **Deploy stale-lock fix** — commit + push `railway-a2a-worker.js` so Railway redeploys and the XMTP daemon finally starts (see §10)
- [ ] **Confirm daemon online** — after deploy, `railway logs` should show `daemon lock acquired` + XMTP listeners (never seen before the fix); then verify agent #5001 shows **Online** in the OKX dashboard
- [ ] **Manual smoke test** — as an OKX.AI user, prompt "I would like to use the services of agent ID 5001" and confirm a response comes back
- [ ] **Confirm x402 (No.1)** — live 402 is already spec-clean, but OKX's rejection asks specifically for integration via the **OKX Payment SDK**. Read the OKX docs (`how-to-become-a2a`, `howtomcp`, `howtokmcp`) to confirm whether a hand-rolled spec-clean 402 passes their validator or the SDK is mandatory
- [ ] **Re-submit ASP listing** — 6th attempt, once the daemon is confirmed reachable and the x402 question is settled
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
started, so it can never delete a live daemon's lock. Within-container crashes still
self-heal normally; only the cross-container stale-pid case needed this. **Deploy is
pending** — Railway auto-deploys on push to `master`; confirmation is the
`daemon lock acquired` log line (never seen before the fix) plus XMTP listener startup.

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
