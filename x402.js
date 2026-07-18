const https = require('https');

const XLAYER_RPC = process.env.XLAYER_RPC || 'https://xlayerrpc.okx.com';
// x402 payment realm — the host clients see in the WWW-Authenticate challenge.
// Derived from PUBLIC_BASE_URL so it always matches the deployed domain.
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  'https://shiori-h45s.onrender.com';
const PAYMENT_REALM = PUBLIC_BASE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
const USDT_ADDRESS = '0x1a7e4e63778B4f12a199C063f9831aE1c13e0f8E';
const SHIORI_WALLET = '0xa2fbc18fd6306d84566f85edd6912fc8f91af33c';
const FEE_MINIMAL = '10000';
const FEE_HUMAN = '0.01';
const USDT_DECIMALS = 6;
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

function generateChallenge() {
  const challenge = {
    x402Version: '1',
    accepts: [{
      scheme: 'exact',
      network: 'eip155:196',
      asset: USDT_ADDRESS,
      amount: FEE_MINIMAL,
      payTo: SHIORI_WALLET,
      maxAmountRequired: FEE_MINIMAL,
    }],
  };

  const requestPayload = {
    amount: FEE_MINIMAL,
    currency: USDT_ADDRESS,
    recipient: SHIORI_WALLET,
    methodDetails: {
      chainId: 196,
      feePayer: true,
    },
  };

  const wwwAuthValue = `Payment id="shiori", realm="${PAYMENT_REALM}", method="evm", intent="charge", request="` +
    Buffer.from(JSON.stringify(requestPayload)).toString('base64url') + '"';

  return {
    headerValue: Buffer.from(JSON.stringify(challenge)).toString('base64'),
    wwwAuthValue,
    challenge,
  };
}

async function verifyPayment(xPaymentHeader) {
  try {
    const decoded = JSON.parse(Buffer.from(xPaymentHeader, 'base64').toString());
    const txHash = decoded.txHash || decoded.transactionHash;

    if (!txHash) {
      return { valid: false, reason: 'Missing txHash in payment header' };
    }

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

    const from = '0x' + transferLog.topics[1].slice(26).toLowerCase();
    return { valid: true, payer: from, txHash, onChainVerification: true };
  } catch (err) {
    console.error('verifyPayment error:', err.message);
    return { valid: false, reason: err.message };
  }
}

module.exports = {
  generateChallenge,
  verifyPayment,
  SHIORI_WALLET,
  USDT_ADDRESS,
  FEE_HUMAN,
  FEE_MINIMAL,
  USDT_DECIMALS,
};
