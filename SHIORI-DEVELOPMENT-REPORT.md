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
| `x402.js` | x402 payment challenge generation + on-chain USDT transfer verification |
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
| 4th | 🔄 Under review | Submitted with all fixes |

---

## 4. x402 Payment Protocol

### Challenge Format (sent on unpaid requests)
- **Status**: `402 Payment Required`
- **Header**: `WWW-Authenticate: Payment id="shiori", realm="shiori-h45s.onrender.com", method="evm", intent="charge", request="<base64url>"`  
- **Header**: `PAYMENT-REQUIRED: <base64 json>` (legacy compat)
- **Body**: `{ error, payment: { x402Version, accepts[{ scheme, network, asset, amount, payTo, maxAmountRequired }] } }`

### Payment Verification
- Reads `X-PAYMENT` header from client (base64-encoded `{ txHash, payer }`)
- Verifies on-chain via XLayer RPC (`xlayerrpc.okx.com`)
  - Checks for USDT `Transfer` event in the transaction logs
  - Confirms `to` = Shiori wallet, `amount >= 10000` (0.01 USDT)
- **Retry-then-reject**: RPC call retries up to 3 times (1s/2s backoff, 8s timeout each). If the transaction still can't be verified on-chain, the payment is **rejected** (402) — no accept-on-trust fallback. This closes the hole where a forged `X-PAYMENT` header would pass on any RPC hiccup.
- USDT contract: `0x1a7e4e63778B4f12a199C063f9831aE1c13e0f8E`
- Payee: `0xa2fbc18fd6306d84566f85edd6912fc8f91af33c`

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
Payment:          x402 (custom — on-chain USDT verification via XLayer RPC, 0.01 USDT/req)
Frontend:         Vanilla HTML/CSS/JS with MetaMask integration
Agent Definition: obito.md (system prompt)
Profile Storage:  JSON files under DATA_DIR (Railway volume /data → persistent)
ASP Platform:     OKX.AI (onchainos CLI v4.2.0)
Hosting:          Railway (Docker + persistent volume) — server.js + A2A worker
GitHub:           github.com/oladipsinigami/Shiori
```
