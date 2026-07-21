/**
 * OKX Payment SDK (x402) seller wiring for Shiori.
 *
 * Official path from OKX seller docs (typescript/SELLER.md / howtokmcp):
 *   OKXFacilitatorClient + ExactEvmScheme + x402HTTPResourceServer
 *   + Express paymentMiddlewareFromHTTPServer
 *
 * Network: eip155:196 (X Layer)
 * Default asset (SDK auto): USD₮0 0x779Ded0c9e1022225f8E0630b35a9b54bE713736
 * Price: $0.01 per POST /chat
 */
const { OKXFacilitatorClient } = require('@okxweb3/x402-core');
const {
  x402ResourceServer,
  x402HTTPResourceServer,
  paymentMiddlewareFromHTTPServer,
} = require('@okxweb3/x402-express');
const { ExactEvmScheme } = require('@okxweb3/x402-evm/exact/server');

const NETWORK = 'eip155:196';
const PAY_TO =
  process.env.PAY_TO ||
  process.env.OKX_WALLET_ADDRESS ||
  '0xa2fbc18fd6306d84566f85edd6912fc8f91af33c';
const PRICE = process.env.X402_PRICE || '$0.01';
// Official OKX USD₮0 on X Layer (SDK default when price is a "$..." string).
const USDT0 = '0x779Ded0c9e1022225f8E0630b35a9b54bE713736';

function readOkxCredentials() {
  const apiKey = process.env.OKX_API_KEY || '';
  // Docs use OKX_SECRET_KEY; older notes used OKX_API_SECRET.
  const secretKey = process.env.OKX_SECRET_KEY || process.env.OKX_API_SECRET || '';
  const passphrase = process.env.OKX_PASSPHRASE || process.env.OKX_API_PASSPHRASE || '';
  return { apiKey, secretKey, passphrase };
}

function isConfigured() {
  const { apiKey, secretKey, passphrase } = readOkxCredentials();
  return Boolean(apiKey && secretKey && passphrase);
}

/**
 * Build the SDK resources that all payment gates share:
 *   OKXFacilitatorClient + x402ResourceServer + ExactEvmScheme.
 * Returns null (and logs a w-level message) when OKX API credentials are missing,
 * because the exact-scheme verify/settle flow needs them.  The caller is
 * responsible for falling back to a manual-charge challenge.
 */
function buildPaidResourceServer() {
  if (!isConfigured()) return null;

  const { apiKey, secretKey, passphrase } = readOkxCredentials();
  const facilitatorClient = new OKXFacilitatorClient({
    apiKey,
    secretKey,
    passphrase,
    syncSettle: process.env.OKX_X402_SYNC_SETTLE !== '0',
  });

  const resourceServer = new x402ResourceServer(facilitatorClient).register(
    NETWORK,
    new ExactEvmScheme()
  );
  return resourceServer;
}

/**
 * Fallback: a lightweight Express-compatible middleware that returns a standard
 * 402 Payment Required for unpaid requests, using the same challenge structure
 * the OKX SDK would produce.  Payment verification uses the charge model
 * (on-chain txHash receipt check), so it works without OKX SA API credentials.
 */
function buildChargeMiddleware() {
  return async (req, res, next) => {
    const xPayment =
      req.headers['payment-signature'] ||
      req.headers['x-payment'] ||
      req.headers['x-payment-address'];

    if (xPayment) {
      try {
        const { verifyPayment } = require('./x402');
        const result = await verifyPayment(xPayment);
        if (result.valid) {
          return next();
        }
        // Verification failed — re-issue challenge.
        const challenge = buildChargeChallenge(req);
        return res.status(402).set(challenge.headers).json(challenge.body);
      } catch (err) {
        console.error('[okx-payment] charge verify error:', err.message);
        const challenge = buildChargeChallenge(req);
        return res.status(402).set(challenge.headers).json({
          ...challenge.body,
          error: `Payment verification error: ${err.message}`,
        });
      }
    }

    // Unpaid — return standard 402.
    const challenge = buildChargeChallenge(req);
    return res.status(402).set(challenge.headers).json(challenge.body);
  };
}

/**
 * Build a standard x402 v1 challenge for the charge model.
 */
function buildChargeChallenge(req) {
  const resourceUrl =
    `${req.protocol}://${req.get('host')}${req.originalUrl || req.path}`;

  const body = {
    x402Version: 1,
    error: 'Payment required to access this resource',
    accepts: [
      {
        scheme: 'exact',
        network: NETWORK,
        maxAmountRequired: '10000',
        asset: USDT0,
        payTo: PAY_TO,
        resource: resourceUrl,
        description: 'One Shiori taste recommendation',
        mimeType: 'application/json',
        maxTimeoutSeconds: 300,
        extra: { name: 'USD\u20AE0', version: '1' },
      },
    ],
  };

  const headerValue = Buffer.from(JSON.stringify(body)).toString('base64');

  const requestPayload = {
    amount: '10000',
    currency: USDT0,
    recipient: PAY_TO,
    methodDetails: { chainId: 196, feePayer: true },
  };

  const realm = (process.env.PUBLIC_BASE_URL || 'shiori-h45s.onrender.com')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');

  const wwwAuthValue =
    'Payment id="shiori", realm="' +
    realm +
    '", method="evm", intent="charge", request="' +
    Buffer.from(JSON.stringify(requestPayload)).toString('base64url') +
    '"';

  return {
    body,
    headers: {
      'PAYMENT-REQUIRED': headerValue,
      'WWW-Authenticate': wwwAuthValue,
      'Access-Control-Expose-Headers':
        'PAYMENT-REQUIRED, WWW-Authenticate, X-PAYMENT-RESPONSE',
    },
  };
}

/**
 * Build Express middleware that gates paid routes with a standard x402 402.
 * When OKX SA API credentials are configured, uses the full OKX Payment SDK
 * middleware (exact scheme, EIP-3009, facilitator verify/settle).
 * When credentials are missing, falls back to the "charge" model (on-chain
 * txHash receipt check) so the 402 challenge is always present for the review.
 *
 * @param {Record<string, object>} routes  – SDK route config (ignored in fallback)
 * @returns {{ middleware, initialize, status }}
 */
function buildPaymentGate(routes) {
  const resourceServer = buildPaidResourceServer();

  if (resourceServer) {
    // Full OKX Payment SDK path.
    const publicBase = (
      process.env.PUBLIC_BASE_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      ''
    ).replace(/\/$/, '');
    const httpServer = new x402HTTPResourceServer(resourceServer, routes);
    const middleware = paymentMiddlewareFromHTTPServer(httpServer, undefined, undefined, true);

    let initialized = false;
    async function initialize() {
      await resourceServer.initialize();
      initialized = true;
      console.log(
        `[okx-payment] x402 seller ready network=${NETWORK} payTo=${PAY_TO} price=${PRICE}`
      );
    }

    return {
      configured: true,
      sdkMode: true,
      middleware,
      initialize,
      resourceServer,
      httpServer,
      status: () => ({
        configured: true,
        initialized,
        sdkMode: true,
        network: NETWORK,
        payTo: PAY_TO,
        price: PRICE,
        asset: USDT0,
        sdk: '@okxweb3/x402-express',
        scheme: 'exact',
      }),
    };
  }

  // Fallback: charge-model middleware (no SA API credentials).
  console.warn(
    '[okx-payment] OKX SA API credentials missing — using charge-model fallback. Paid routes will return 402 via txHash receipt check.'
  );
  const middleware = buildChargeMiddleware();

  return {
    configured: true,
    sdkMode: false,
    middleware,
    initialize: async () => {},
    status: () => ({
      configured: true,
      initialized: true,
      sdkMode: false,
      network: NETWORK,
      payTo: PAY_TO,
      price: PRICE,
      asset: USDT0,
      scheme: 'charge',
      note: 'Fallback charge model (no OKX SA API keys). Unpaid requests return standard 402.',
    }),
  };
}

/**
 * Create the payment gate for POST /chat.
 */
function createChatPaymentGate() {
  const publicBase = (
    process.env.PUBLIC_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    ''
  ).replace(/\/$/, '');
  const resourceUrl = publicBase ? `${publicBase}/chat` : undefined;

  return buildPaymentGate({
    'POST /chat': {
      accepts: {
        scheme: 'exact',
        network: NETWORK,
        payTo: PAY_TO,
        price: PRICE,
        maxTimeoutSeconds: 300,
      },
      description: 'One Shiori taste recommendation',
      mimeType: 'application/json',
      ...(resourceUrl ? { resource: resourceUrl } : {}),
    },
  });
}

/**
 * Create the payment gate for POST /a2mcp/invoke (and /mcp/invoke).
 * Used by the OKX.AI platform review to verify x402 compliance.
 */
function createA2mcpPaymentGate() {
  const publicBase = (
    process.env.PUBLIC_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    ''
  ).replace(/\/$/, '');
  const resourceUrl = publicBase ? `${publicBase}/a2mcp/invoke` : undefined;

  return buildPaymentGate({
    'POST /a2mcp/invoke': {
      accepts: {
        scheme: 'exact',
        network: NETWORK,
        payTo: PAY_TO,
        price: PRICE,
        maxTimeoutSeconds: 300,
      },
      description: 'One Shiori taste recommendation via A2MCP',
      mimeType: 'application/json',
      ...(resourceUrl ? { resource: resourceUrl } : {}),
    },
    'POST /mcp/invoke': {
      accepts: {
        scheme: 'exact',
        network: NETWORK,
        payTo: PAY_TO,
        price: PRICE,
        maxTimeoutSeconds: 300,
      },
      description: 'One Shiori taste recommendation via MCP',
      mimeType: 'application/json',
      ...(resourceUrl ? { resource: resourceUrl.replace(/\/a2mcp\//, '/mcp/') } : {}),
    },
  });
}

/**
 * Trusted internal callers (okx-a2a → shiori-claude-shim → brain) must not be
 * blocked by x402. Marketplace XMTP delivery hits the brain over loopback
 * (or with a shared secret); public unpaid clients still get a standard 402.
 */
function isTrustedInternal(req) {
  const key = process.env.SHIORI_INTERNAL_KEY;
  if (key) {
    const header = req.get?.('x-shiori-internal-key') || req.headers?.['x-shiori-internal-key'];
    if (header && header === key) return true;
  }

  const ip =
    req.ip ||
    req.socket?.remoteAddress ||
    (req.connection && req.connection.remoteAddress) ||
    '';
  if (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.endsWith('/127.0.0.1')
  ) {
    return true;
  }

  // Explicit opt-in for non-loopback internal hops (e.g. Render private).
  if (process.env.SHIORI_TRUST_PROXY_INTERNAL === '1') {
    const xf = (req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    if (xf === '127.0.0.1' || xf === '::1') return true;
  }

  return false;
}

module.exports = {
  createChatPaymentGate,
  createA2mcpPaymentGate,
  buildChargeChallenge,
  isTrustedInternal,
  isConfigured,
  NETWORK,
  PAY_TO,
  PRICE,
  USDT0,
};
