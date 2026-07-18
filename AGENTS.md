# Shiori — Agent / project notes

Shiori is an OKX Agent Service Provider (ASP) listed on the OKX.AI marketplace.
The public site + `/chat` brain live in `server.js`; x402 payment gating is in
`x402.js`. It deploys to Render (and optionally Railway via `scripts/railway-start.js`).

## x402 payment integration (READ BEFORE TOUCHING PAYMENTS)

The listing was **rejected on 2026-07-18** for failing "x402 standard validation":
the unpaid `/chat` request did not return a standard 402 challenge. Fix in progress.

### Hard values (verified — do NOT re-derive from the blocked docs domain)

- **X Layer network**: mainnet chainId **196** (hex `0xC4`) = CAIP-2 **`eip155:196`**.
  Testnet is **1952** (hex `0x7A0`) after the 2026 re-genesis; ignore stale `195`.
- **USDT (paid asset)**: `0x1a7e4e63778B4f12a199C063f9831aE1c13e0f8E`, 6 decimals.
- **Shiori payTo wallet**: `0xa2fbc18fd6306d84566f85edd6912fc8f91af33c`.
- **Fee**: `0.01` USDT = `10000` minimal units.

### OKX verify/settle — NOT a plug-in facilitator URL

OKX has **no drop-in facilitator** (unlike Coinbase's `x402.org/facilitator`) and
**no official npm seller SDK** (confirmed: nothing under `@okxweb3`/`@okx` npm scopes).
Seller-side settlement = call OKX's two authenticated REST endpoints directly:

- `POST https://web3.okx.com/api/v6/pay/x402/verify`
- `POST https://web3.okx.com/api/v6/pay/x402/settle`

Auth = OKX exchange-API v5 style HMAC. Every request needs these headers:
`OK-ACCESS-KEY`, `OK-ACCESS-SIGN`, `OK-ACCESS-PASSPHRASE`, `OK-ACCESS-TIMESTAMP`.
`OK-ACCESS-SIGN` = base64( HMAC-SHA256( `${timestamp}${method}${requestPath}${body}`,
secret ) ), timestamp = ISO-8601 (`new Date().toISOString()`).

Credentials come from the OKX developer portal and are env vars (never commit):
`OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE`.

> The exact JSON request/response schema of `/verify` and `/settle` is documented only
> at `web3.okx.com/onchainos/dev-docs/payments/*`, which is DNS-blocked from the agent
> sandbox. Field names in `okx-x402.js` marked `// TODO(okx-schema)` are best-effort and
> must be confirmed against those docs (or by allowlisting `web3.okx.com` in
> `.claude/settings.local.json` → `sandbox.allowedDomains`) before relying on live settlement.

### Two OKX seller 402 models

- **`accepts`-based** (canonical x402): 402 body `{x402Version:1, error, accepts[]}`;
  client pays with an **EIP-3009 signed authorization** in the `X-PAYMENT` header
  (gasless, no tx). Requires the token to support `transferWithAuthorization`.
- **`charge`** (`WWW-Authenticate: Payment ... intent="charge"`): client sends the ERC-20
  transfer itself (e.g. MetaMask) and returns the **txHash**. Works with any ERC-20.

**Shiori uses the `charge` model** — it matches the existing MetaMask send-transfer
frontend in `public/app.js`. The 402 still carries a spec-correct `accepts`-based body
(so generic x402 validators/clients parse it) *and* the `WWW-Authenticate` charge header.

### Canonical 402 body shape (protocol v1) — every field required

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
    "resource": "https://<host>/chat",
    "description": "One Shiori taste recommendation",
    "mimeType": "application/json",
    "maxTimeoutSeconds": 300,
    "extra": { "name": "USDT", "version": "1" }
  }]
}
```

`x402Version` MUST be the number `1`, not the string `"1"`.
Reference (canonical, reachable): https://raw.githubusercontent.com/coinbase/x402/main/specs/x402-specification-v1.md

### Domain allowlist (unblock `web3.okx.com`)

If the agent sandbox blocks `web3.okx.com`, add it to `~/.claude/settings.json` or `.claude/settings.local.json`:

```json
{
  "sandbox": {
    "allowedDomains": ["web3.okx.com", "raw.githubusercontent.com"]
  }
}
```

`raw.githubusercontent.com` is usually allowed by default and can serve the skill source
(`raw.githubusercontent.com/okx/onchainos-skills/...`) when the docs domain is blocked.

### OKX SDK / package note

No standalone npm SDK for the OKX x402 seller flow exists under `@okx` or `@okxweb3` scope.
OKX's push is through the skill layer (`npx skills add okx/onchainos-skills`), which handles
verify/settle calls inside an agent context rather than a code SDK. The facilitator endpoints
operate on **signed EIP-712 authorizations** (gasless `exact` scheme), not txHashes — they
don't apply to Shiori's charge model (payment is already on-chain when the server sees it).
