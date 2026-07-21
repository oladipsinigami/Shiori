# Shiori — Agent / project notes

Shiori is an OKX Agent Service Provider (ASP) listed on the OKX.AI marketplace.
The public site + `/chat` brain live in `server.js`; x402 payment gating is in
`x402.js`. It deploys to Render (and optionally Railway via `scripts/railway-start.js`).

## x402 payment integration (READ BEFORE TOUCHING PAYMENTS)

The listing was **rejected on 2026-07-18** for failing "x402 standard validation":
the unpaid `/chat` request did not return a standard 402 challenge. Fix in progress.

### Hard values (verified)

- **X Layer network**: mainnet chainId **196** (hex `0xC4`) = CAIP-2 **`eip155:196`**.
  Testnet is **1952** (hex `0x7A0`) after the 2026 re-genesis; ignore stale `195`.
- **Paid asset (official OKX USD₮0)**: `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`, 6 decimals.
  (Older USDT `0x1a7e4e…` is legacy; do not use for x402 listing validation.)
- **Shiori payTo wallet**: `0xa2fbc18fd6306d84566f85edd6912fc8f91af33c`.
- **Fee**: `$0.01` per `POST /chat` (SDK price string → 10000 minimal units).

### OKX Payment SDK (REQUIRED for listing)

OKX review requires the **OKX Payment SDK**, not a hand-rolled 402 body.

Packages: `@okxweb3/x402-core`, `@okxweb3/x402-evm`, `@okxweb3/x402-express`.

Wiring lives in `okx-payment.js` + Express `server.js`:

- `OKXFacilitatorClient` (HMAC SA API) + `ExactEvmScheme` on `eip155:196`
- `x402HTTPResourceServer` route `POST /chat` with `scheme: "exact"`, `price: "$0.01"`
- `paymentMiddlewareFromHTTPServer` — unpaid public clients get a **standard 402**

Env (never commit):

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