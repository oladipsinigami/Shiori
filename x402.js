const https = require('https');

const XLAYER_RPC = process.env.XLAYER_RPC || 'https://xlayerrpc.okx.com';
const USDT_ADDRESS = '0x1a7e4e63778B4f12a199C063f9831aE1c13e0f8E';
const SHIORI_WALLET = '0xa2fbc18fd6306d84566f85edd6912fc8f91af33c';
const FEE_MINIMAL = '1000';
const FEE_HUMAN = '0.001';
const USDT_DECIMALS = 6;
const RPC_TIMEOUT = 8000;

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

  const wwwAuthValue = 'Payment id="shiori", realm="shiori-h45s.onrender.com", method="evm", intent="charge", request="' +
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
      receipt = await rpcCall('eth_getTransactionReceipt', [txHash]);
    } catch (rpcErr) {
      console.error('RPC error, accepting payment on trust:', rpcErr.message);
      return {
        valid: true,
        payer: decoded.payer || 'unknown',
        txHash,
        onChainVerification: false,
      };
    }

    if (!receipt || !receipt.result) {
      console.error('Tx not found on-chain, accepting on trust:', txHash);
      return {
        valid: true,
        payer: decoded.payer || 'unknown',
        txHash,
        onChainVerification: false,
      };
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
