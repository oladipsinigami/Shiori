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
 * Build Express middleware that gates POST /chat with a standard x402 402.
 * Returns { middleware, initialize, resourceServer, status }.
 */
function createChatPaymentGate() {
  if (!isConfigured()) {
    return {
      configured: false,
      middleware: null,
      initialize: async () => {
        throw new Error(
          'OKX Payment SDK not configured — set OKX_API_KEY, OKX_SECRET_KEY (or OKX_API_SECRET), OKX_PASSPHRASE'
        );
      },
      status: () => ({
        configured: false,
        network: NETWORK,
        payTo: PAY_TO,
        price: PRICE,
        asset: USDT0,
        sdk: '@okxweb3/x402-express',
      }),
    };
  }

  const { apiKey, secretKey, passphrase } = readOkxCredentials();

  const facilitatorClient = new OKXFacilitatorClient({
    apiKey,
    secretKey,
    passphrase,
    // Prefer waiting for settlement confirmation before returning paid content.
    syncSettle: process.env.OKX_X402_SYNC_SETTLE !== '0',
  });

  const resourceServer = new x402ResourceServer(facilitatorClient).register(
    NETWORK,
    new ExactEvmScheme()
  );

  // Prefer PUBLIC_BASE_URL so challenges name the listing URL (often Render)
  // even when the SDK runs on Railway (or is reached via the Render proxy).
  const publicBase = (
    process.env.PUBLIC_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    ''
  ).replace(/\/$/, '');
  const resourceUrl = publicBase ? `${publicBase}/chat` : undefined;

  const routes = {
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
  };

  const httpServer = new x402HTTPResourceServer(resourceServer, routes);
  // true = sync facilitator supported schemes on first request / init
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
    middleware,
    initialize,
    resourceServer,
    httpServer,
    status: () => ({
      configured: true,
      initialized,
      network: NETWORK,
      payTo: PAY_TO,
      price: PRICE,
      asset: USDT0,
      sdk: '@okxweb3/x402-express',
      scheme: 'exact',
    }),
  };
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
  isTrustedInternal,
  isConfigured,
  NETWORK,
  PAY_TO,
  PRICE,
  USDT0,
};
