# Shiori (Obito) — Development & Deployment Report

## Overview

**Shiori** (formerly codenamed Obito) is an AI Librarian Recommendation Agent built for the **OKX.AI Genesis Hackathon**. It delivers 1–3 personalized movie/anime/novel recommendations with human-like reasoning, an evolving taste profile, and proactive time-awareness.

---

## 1. Project Setup

| Item | Detail |
|---|---|
| **Working Directory** | `C:\Users\oladips\Downloads\Obito` |
| **Runtime** | Node.js v22 |
| **LLM Provider** | OpenRouter (`openrouter/auto`) |
| **API Key** | OpenRouter (sk-or-v1-...) |
| **Code** | GitHub: `github.com/oladipsinigami/Shiori` |

### Key Files

| File | Purpose |
|---|---|
| `obito.md` | System prompt / agent personality definition |
| `obito-core.js` | Core logic: LLM calls (Gemini → migrated to OpenRouter), profile storage, recommendation logging |
| `server.js` | HTTP server — serves the agent via `POST /chat` and `GET /health` |
| `obito.js` | CLI wrapper for local testing |
| `package.json` | Node.js project config |
| `render.yaml` | Render Blueprint for deployment |

### Migrations Made

- **Gemini → OpenRouter**: Switched API provider to support more models (Claude, GPT, Grok, etc.)
- **GEMINI_API_KEY → OPENROUTER_API_KEY**: Environment variable renamed
- **Model configurable via `OPENROUTER_MODEL`** env var

---

## 2. Oracle Cloud VM Deployment (Previous — Instance Down)

| Item | Detail |
|---|---|
| **Provider** | Oracle Cloud Free Tier |
| **Instance** | Ampere A1 (ARM64, 4 OCPU, 24GB RAM) |
| **OS** | Oracle Linux 9.7 |
| **IP** | `145.241.103.250` (VM unreachable) |
| **Process Manager** | PM2 v7 |

### Services Running via PM2

| Service | Status |
|---|---|
| `obito` (HTTP server) | Online (88m uptime at last check) |
| `okx-a2a` (A2A daemon) | Running (pid 119092) |

### Installed Tools

| Tool | Version |
|---|---|
| Node.js | v22.23.1 |
| OnchainOS CLI | v3.21.6-beta (from GitHub releases) |
| okx-a2a | v0.1.7 |
| OpenClaw CLI | 2026.6.11 |
| PM2 | v7.0.3 |

---

## 3. OKX AI ASP Registration

| Item | Detail |
|---|---|
| **Agent Name** | Shiori |
| **Agent ID** | #5001 |
| **Role** | Agent Service Provider (ASP) |
| **Wallet Address** | `0xa2fbc18fd6306d84566f85edd6912fc8f91af33c` |
| **Avatar** | Uploaded to OKX CDN |
| **Service** | "Media Recommendations" (A2A, 0 USDT) |
| **Status** | **Live on OKX.AI** |
| **Approval Notes** | ✅ Fully approved |

### Registration Process

1. Installed OnchainOS CLI (`v3.21.6-beta` — required for ARM64 compatibility with glibc 2.34)
2. Installed `@okxweb3/a2a-node@latest` (A2A communication layer)
3. Logged in to Agentic Wallet with `oladipupos111@gmail.com`
4. Created ASP identity via `onchainos agent create`
5. Uploaded avatar via `onchainos agent upload`
6. Submitted for review via `onchainos agent activate`

### Review Stuck — Issue Found & Fixed

**Problem**: Service description failed validation — needed **2-part format** (core capability + what user must provide).

**Old** (single sentence):
> "Get 1-3 handpicked movies, anime, or novels matched to your unique taste, mood, and schedule"

**Fixed** (2-part):
> "I recommend 1-3 personalized movies, anime, or novels matched to your unique taste, mood, and schedule.
> To get started, tell me about your favorite stories, your current mood, and how much time you have."

**Validation**: Now passes `agent validate-listing` with no findings.

---

## 4. A2A Communication Layer

| Item | Detail |
|---|---|
| **okx-a2a daemon** | Running (PID varied 119K–135K) |
| **AI Provider** | OpenClaw (installed via npm) |
| **OpenClaw Gateway** | Running on `ws://127.0.0.1:18789` |
| **Gateway Plugin Issue** | `@okxweb3/a2a-openclaw` plugin could not be installed — incompatible with OpenClaw 2026.6.11 plugin format |

### Open Issues

- OpenClaw okx-a2a plugin not installed (version mismatch between `@okxweb3/a2a-openclaw@0.1.7` and OpenClaw 2026.6.11)
- OpenClaw gateway not properly connected to okx-a2a daemon ("device identity required")
- These affect A2A messaging capability but do not block the HTTP endpoint

---

## 5. Deployment Strategy

### Current State

| Component | Status |
|---|---|
| Oracle Cloud VM | **Down** (instance unreachable) |
| Shiori on OKX.AI | **Live** but showing **offline** (backend down) |
| GitHub Repo | Pushed and ready |
| Render Blueprint | Configured (`render.yaml`) — **not yet deployed** |

### Next Steps to Go Live

1. **Deploy on Render** using GitHub repo via Render Dashboard
2. **Set environment variables** in Render:
   - `OPENROUTER_API_KEY` = `<your-openrouter-key>`
   - `OPENROUTER_MODEL` = `openrouter/auto`
3. **Set Render health check** path to `/health`
4. **Verify** Shiori comes back online on OKX.AI

### Alternative Hosting Options

| Platform | Free Tier | Notes |
|---|---|---|
| Render | 750h/mo | Spins down after inactivity (cold start ~5s) |
| Railway | 500h/mo | More persistent, less cold start |
| Fly.io | 3 always-on VMs | Best uptime, no cold starts |

---

## 6. Hackathon Submission

| Item | Detail |
|---|---|
| **Hackathon** | OKX.AI Genesis Hackathon (HackQuest) |
| **Prize Pool** | $100,000 |
| **Submission Deadline** | July 17, 2026 (23:59 UTC) |
| **Status** | ✅ Fully approved & live on OKX.AI |

### Required Steps

- [x] Build ASP (Shiori)
- [x] Submit ASP for listing on OKX.AI
- [x] Pass AI quality review (✅ approved)
- [x] **Go live on OKX.AI** (✅ live)
- [ ] Deploy backend so agent shows online
- [ ] Post on X with `#OKXAI`
- [ ] Submit HackQuest Google Form before Jul 17

---

## 7. Tech Stack Summary

```
LLM API:          OpenRouter → openrouter/auto (switchable via OPENROUTER_MODEL)
Runtime:          Node.js v22
Backend Server:   Express HTTP (server.js)
Agent Definition: obito.md (system prompt)
Profile Storage:  Local JSON files (data/profiles/)
Process Manager:  PM2
AI Agent Layer:   OpenClaw 2026.6.11
A2A Comms:        okx-a2a v0.1.7
ASP Platform:     OKX.AI (onchainos CLI v3.21.6-beta)
Hosting:          [Pending — Oracle VM down, Render not yet deployed]
GitHub:           github.com/oladipsinigami/Shiori
```
