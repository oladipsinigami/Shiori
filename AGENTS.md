# Shiori — Agent / project notes

Shiori is an OKX Agent Service Provider (ASP) listed on the OKX.AI marketplace.
The public site + `/chat` brain live in `server.js`; x402 payment gating is in
`okx-payment.js` (SDK path) and `x402.js` (charge-model fallback).
Deploys to Render (and optionally Railway via `scripts/railway-start.js`).

## x402 payment integration (READ BEFORE TOUCHING PAYMENTS)

The listing was **rejected on 2026-07-22** (2nd rejection) for:
1. x402 standard validation — **FIXED**: A2MCP endpoint now returns 402
2. Agent not responding / timing out — **FIXED**: unpaid A2MCP returns instant 402 (no timeout)

### Architecture

Two payment models coexist via `okx-payment.js`:

- **SDK (exact scheme)**: When `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` are set
  → full OKX Payment SDK middleware (`@okxweb3/x402-express`, `OKXFacilitatorClient`,
  `ExactEvmScheme`, `x402HTTPResourceServer`). Unpaid requests get standard 402;
  paid requests verified via OKX SA API (EIP-3009 gasless exact scheme).

- **Charge-model fallback**: When SA API credentials are missing → inline middleware
  (`buildChargeMiddleware`) returns a standard x402 v1 challenge for unpaid requests;
  paid requests verified on-chain via RPC receipt (`x402.js`).
  This ensures the listing always returns 402 even without SA keys.

### Routes gated

| Route | Gate | Notes |
|---|---|---|
| `POST /chat` | `createChatPaymentGate()` | Web frontend + marketplace XMTP |
| `POST /a2mcp/invoke` | `createA2mcpPaymentGate()` | OKX.AI platform review + A2MCP clients |
| `POST /mcp/invoke` | same as above | Alias |

`isTrustedInternal()` bypasses payment for loopback / `X-Shiori-Internal-Key`.

### Hard values (verified)

- **X Layer network**: mainnet chainId **196** (hex `0xC4`) = CAIP-2 **`eip155:196`**.
  Testnet is **1952** (hex `0x7A0`) after the 2026 re-genesis; ignore stale `195`.
- **Paid asset (official OKX USD₮0)**: `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`, 6 decimals.
  (SDK's `ExactEvmScheme` default for `eip155:196`; older USDT `0x1a7e4e…` is legacy.)
- **Shiori payTo wallet**: `0xa2fbc18fd6306d84566f85edd6912fc8f91af33c`.
- **Fee**: `$0.01` per call (SDK price string → 10000 minimal units).

### OKX Payment SDK (installed)

```
@okxweb3/x402-core@0.1.0
@okxweb3/x402-evm@0.2.1
@okxweb3/x402-express@0.1.1
```

### Env (never commit)

```
OKX_API_KEY=...
OKX_SECRET_KEY=...       # also accepts OKX_API_SECRET
OKX_PASSPHRASE=...
PAY_TO=0xa2fbc18fd6306d84566f85edd6912fc8f91af33c
```

Seller reference (when `web3.okx.com` is DNS-blocked):  
https://raw.githubusercontent.com/okx/payments/master/typescript/SELLER.md

### Internal free path (marketplace XMTP)

okx-a2a → `shiori-claude-shim.js` → `POST /chat` must not require payment.
`isTrustedInternal()` allows loopback (`127.0.0.1`) or header `X-Shiori-Internal-Key`
matching `SHIORI_INTERNAL_KEY`. Railway `railway-start.js` sets `SHIORI_URL` to loopback.

### Domain allowlist

```json
{
  "sandbox": {
    "allowedDomains": ["web3.okx.com", "raw.githubusercontent.com"]
  }
}
```
