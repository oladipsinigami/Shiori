// OKX OnchainOS x402 facilitator client — DORMANT (exact-scheme, signed-payload).
//
// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: Shiori currently uses the x402 "charge" model, where the buyer's
// wallet (MetaMask) sends the USDT transfer ITSELF and replays with the resulting
// txHash. In that model the payment is already on-chain by the time the server
// sees it, so verification is a direct on-chain RPC receipt check (see x402.js) —
// there is nothing for a facilitator to "settle". This module is therefore NOT
// wired into the charge flow.
//
// It is kept for the day Shiori adds the canonical "exact" scheme, where the buyer
// signs an EIP-712 / EIP-3009 authorization (gasless, no tx) and the facilitator
// verifies the signature off-chain and then broadcasts settlement on-chain.
//
// The facilitator interface below matches the x402 v1 spec §7 (verified against
// coinbase/x402 specs/x402-specification-v1.md and Binance's B402 mirror):
//   POST /verify  { x402Version, paymentPayload, paymentRequirements }
//                 → { isValid: bool, invalidReason?, payer }
//   POST /settle  (same request body)
//                 → { success: bool, errorReason?, payer, transaction, network }
// There is NO txHash input — the signed authorization IS the input; /settle is
// what turns it into an on-chain transaction.
//
// OKX exposes no plug-in facilitator URL and no npm seller SDK; the equivalent
// OKX endpoints are authenticated REST (HMAC, OKX exchange-API v5 style) at
// web3.okx.com/api/v6/pay/x402/{verify,settle}. Credentials from the OKX dev
// portal, read from env: OKX_API_KEY / OKX_API_SECRET / OKX_API_PASSPHRASE.
// ─────────────────────────────────────────────────────────────────────────────

const https = require('https');
const crypto = require('crypto');

const OKX_HOST = 'web3.okx.com';
const VERIFY_PATH = '/api/v6/pay/x402/verify';
const SETTLE_PATH = '/api/v6/pay/x402/settle';
const REQUEST_TIMEOUT = 10000;

const API_KEY = process.env.OKX_API_KEY || '';
const API_SECRET = process.env.OKX_API_SECRET || '';
const API_PASSPHRASE = process.env.OKX_API_PASSPHRASE || '';

function isConfigured() {
  return Boolean(API_KEY && API_SECRET && API_PASSPHRASE);
}

// OK-ACCESS-SIGN = base64( HMAC-SHA256( timestamp + method + requestPath + body, secret ) )
function sign(timestamp, method, requestPath, body) {
  const prehash = `${timestamp}${method}${requestPath}${body}`;
  return crypto.createHmac('sha256', API_SECRET).update(prehash).digest('base64');
}

function postSigned(requestPath, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const timestamp = new Date().toISOString();
    const method = 'POST';

    const options = {
      hostname: OKX_HOST,
      port: 443,
      path: requestPath,
      method,
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'OK-ACCESS-KEY': API_KEY,
        'OK-ACCESS-SIGN': sign(timestamp, method, requestPath, body),
        'OK-ACCESS-PASSPHRASE': API_PASSPHRASE,
        'OK-ACCESS-TIMESTAMP': timestamp,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); }
        catch { return reject(new Error(`OKX ${requestPath} returned non-JSON (status ${res.statusCode})`)); }
        resolve({ status: res.statusCode, json });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`OKX ${requestPath} timeout`)); });
    req.write(body);
    req.end();
  });
}

// Unwrap OKX's v5-style envelope ({ code:"0", data:[...] }) if present, else the
// facilitator may return the x402 response object directly.
function unwrap(json) {
  if (json && (json.code === '0' || json.code === 0) && Array.isArray(json.data)) return json.data[0];
  if (json && json.data && typeof json.data === 'object' && !Array.isArray(json.data)) return json.data;
  return json;
}

// EXACT-scheme verify: takes the signed paymentPayload + the paymentRequirements
// (accepts[] entry). Returns { isValid, invalidReason, payer }.
async function verify({ paymentPayload, paymentRequirements }) {
  const { status, json } = await postSigned(VERIFY_PATH, {
    x402Version: 1,
    paymentPayload,
    paymentRequirements,
  });
  const r = unwrap(json);
  return {
    isValid: Boolean(r && r.isValid),
    invalidReason: r && r.invalidReason ? r.invalidReason : (status !== 200 ? `http_${status}` : undefined),
    payer: r && r.payer,
    raw: json,
  };
}

// EXACT-scheme settle: broadcasts the verified authorization on-chain.
// Returns { success, errorReason, payer, transaction, network }.
async function settle({ paymentPayload, paymentRequirements }) {
  const { status, json } = await postSigned(SETTLE_PATH, {
    x402Version: 1,
    paymentPayload,
    paymentRequirements,
  });
  const r = unwrap(json);
  return {
    success: Boolean(r && r.success),
    errorReason: r && r.errorReason ? r.errorReason : (status !== 200 ? `http_${status}` : undefined),
    payer: r && r.payer,
    transaction: (r && r.transaction) || '',
    network: r && r.network,
    raw: json,
  };
}

module.exports = { isConfigured, verify, settle };
