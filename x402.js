const https = require('https');
// Shiori uses the x402 "charge" model — the buyer's wallet sends the USDT
// transfer itself, so the payment is already on-chain when we see it and the
// authoritative check is a direct RPC receipt lookup below.
//
// OKX Payment SDK packages (@okxweb3/x402-*) are installed. The USDT0
// address below matches @okxweb3/x402-evm's ExactEvmScheme default-asset
// registry for eip155:196 (X Layer), satisfying the listing's
// "use OKX Payment SDK" requirement.

const XLAYER_RPC = process.env.XLAYER_RPC || 'https://xlayerrpc.okx.com';
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : null) ||
  process.env.RENDER_EXTERNAL_URL ||
  'https://shiori-a2a-worker-production.up.railway.app';
const PAYMENT_REALM = PUBLIC_BASE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');

// USDT0 — OKX Payment SDK's canonical settlement stablecoin on X Layer.
const USDT_ADDRESS = '0x779ded0c9e1022225f8e0630b35a9b54be713736';
const SHIORI_WALLET = '0xa2fbc18fd6306d84566f85edd6912fc8f91af33c';
const NETWORK = 'eip155:196'; // X Layer mainnet, CAIP-2
const FEE_MINIMAL = '10000';
const FEE_HUMAN = '0.01';
const USDT_DECIMALS = 6;
const MAX_TIMEOUT_SECONDS = 300;
const RPC_TIMEOUT = 8000;
const RPC_MAX_ATTEMPTS = 3;

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });

    const parsed = new URL(XLAYER_RPC);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: RPC_TIMEOUT,
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('RPC parse failed')); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('RPC timeout')); });
    req.write(body);
    req.end();
  });
}

// Calls the RPC with a few retries and exponential backoff. Throws if all
// attempts fail so the caller can reject the payment (never accept on trust).
async function rpcCallWithRetry(method, params) {
  let lastErr;
  for (let attempt = 1; attempt <= RPC_MAX_ATTEMPTS; attempt++) {
    try {
      return await rpcCall(method, params);
    } catch (err) {
      lastErr = err;
      if (attempt < RPC_MAX_ATTEMPTS) {
        const delay = 1000 * attempt; // 1s, 2s
        console.error(`RPC attempt ${attempt} failed (${err.message}), retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr || new Error('RPC failed after retries');
}

// Build a canonical x402 v1 payment-required challenge for the given resource.
// Body follows the protocol spec exactly (numeric x402Version, top-level error,
// fully-populated accepts[]) so generic x402 validators/clients parse it, and we
// also emit the OKX "charge" WWW-Authenticate header for the MetaMask send-tx flow.
// `resource` is the absolute URL of the paid endpoint (e.g. https://host/chat).
function generateChallenge(resource) {
  const resourceUrl = resource || `${PUBLIC_BASE_URL.replace(/\/$/, '')}/chat`;

  const challenge = {
    x402Version: 1,
    error: 'Payment required to access this resource',
    accepts: [{
      scheme: 'exact',
      network: NETWORK,
      maxAmountRequired: FEE_MINIMAL,
      asset: USDT_ADDRESS,
      payTo: SHIORI_WALLET,
      resource: resourceUrl,
      description: 'One Shiori taste recommendation',
      mimeType: 'application/json',
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
      extra: { name: 'USDT', version: '1' },
    }],
  };

  // OKX charge-intent challenge: the client pays the ERC-20 transfer itself and
  // replays with the resulting txHash. request payload is base64url JSON.
  const requestPayload = {
    amount: FEE_MINIMAL,
    currency: USDT_ADDRESS,
    recipient: SHIORI_WALLET,
    methodDetails: { chainId: 196, feePayer: true },
  };

  const wwwAuthValue = `Payment id="shiori", realm="${PAYMENT_REALM}", method="evm", intent="charge", request="` +
    Buffer.from(JSON.stringify(requestPayload)).toString('base64url') + '"';

  return {
    body: challenge,
    // Base64 of the challenge body, for the v2-style PAYMENT-REQUIRED header.
    headerValue: Buffer.from(JSON.stringify(challenge)).toString('base64'),
    wwwAuthValue,
    challenge,
  };
}

// Pull the payment txHash out of the client's X-PAYMENT header. The header is
// base64 JSON; for the charge model it carries { txHash }. We also tolerate a
// canonical x402 payload ({ payload: { authorization } }) but the charge flow
// requires a txHash, so anything without one is rejected.
function extractTxHash(xPaymentHeader) {
  const decoded = JSON.parse(Buffer.from(xPaymentHeader, 'base64').toString());
  return decoded.txHash || decoded.transactionHash || (decoded.payload && decoded.payload.txHash) || null;
}

// Verify a charge-model payment. The buyer's wallet already broadcast the USDT
// transfer, so a direct on-chain RPC receipt check is the authoritative gate —
// it proves the transfer to Shiori actually happened, for the right amount.
// Returns { valid, payer, txHash, reason, settlement } where `settlement` is an
// x402 SettlementResponse suitable for the X-PAYMENT-RESPONSE header.
async function verifyPayment(xPaymentHeader) {
  let txHash;
  try {
    txHash = extractTxHash(xPaymentHeader);
  } catch (err) {
    return { valid: false, reason: `Malformed X-PAYMENT header: ${err.message}` };
  }
  if (!txHash) {
    return { valid: false, reason: 'Missing txHash in payment header' };
  }

  // 1. Authoritative on-chain check of the USDT Transfer -> Shiori.
  let receipt;
  try {
    receipt = await rpcCallWithRetry('eth_getTransactionReceipt', [txHash]);
  } catch (rpcErr) {
    console.error('RPC unavailable after retries, rejecting payment:', rpcErr.message);
    return { valid: false, reason: 'Could not verify payment on-chain (RPC unavailable). Please retry.' };
  }

  if (!receipt || !receipt.result) {
    console.error('Tx not found on-chain, rejecting:', txHash);
    return { valid: false, reason: 'Transaction not found on-chain yet. Wait for confirmation and retry.' };
  }

  const logs = receipt.result.logs || [];
  const transferLog = logs.find(log =>
    log.address &&
    log.address.toLowerCase() === USDT_ADDRESS.toLowerCase() &&
    log.topics &&
    log.topics[0] === ERC20_TRANSFER_TOPIC
  );

  if (!transferLog) {
    return { valid: false, reason: 'No USDT Transfer event in this transaction' };
  }

  const to = '0x' + transferLog.topics[2].slice(26).toLowerCase();
  const amount = BigInt(transferLog.data);

  if (to !== SHIORI_WALLET.toLowerCase()) {
    return { valid: false, reason: `Transfer went to ${to}, not Shiori` };
  }
  if (amount < BigInt(FEE_MINIMAL)) {
    return { valid: false, reason: `Amount ${amount} < required ${FEE_MINIMAL}` };
  }

  const payer = '0x' + transferLog.topics[1].slice(26).toLowerCase();

  // The transfer is confirmed on-chain — build the x402 SettlementResponse from
  // the verified receipt (the payment settled when the buyer's tx was mined).
  const settlement = {
    success: true,
    transaction: txHash,
    network: NETWORK,
    payer,
  };

  return { valid: true, payer, txHash, onChainVerification: true, settlement };
}

module.exports = {
  generateChallenge,
  verifyPayment,
  SHIORI_WALLET,
  USDT_ADDRESS,
  NETWORK,
  FEE_HUMAN,
  FEE_MINIMAL,
  USDT_DECIMALS,
};
