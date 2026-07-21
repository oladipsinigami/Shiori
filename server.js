require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { runObito } = require('./obito-core');
const {
  agentCard,
  handleJsonRpc,
  handleRestTask,
  handleA2mcpInvoke,
  a2mcpTools,
  getTask,
  PUBLIC_BASE_URL,
} = require('./a2a');
const {
  createChatPaymentGate,
  isTrustedInternal,
  PAY_TO,
  PRICE,
  USDT0,
  NETWORK,
} = require('./okx-payment');

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

const app = express();
// Trust proxy so req.ip / protocol are correct behind Render/Railway.
app.set('trust proxy', true);

app.use(express.json({ limit: '2mb' }));

// CORS for browser + x402 payment headers (SDK uses PAYMENT-SIGNATURE / X-PAYMENT).
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-PAYMENT, PAYMENT-SIGNATURE, X-PAYMENT-RESPONSE, X-Shiori-Internal-Key'
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE, WWW-Authenticate'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

const paymentGate = createChatPaymentGate();

// --- Health / debug / discovery (free) ---

app.get(['/health', '/ready'], (_req, res) => {
  res.json({
    status: 'ok',
    service: 'shiori',
    a2a: true,
    publicUrl: PUBLIC_BASE_URL,
    okxAgentId: process.env.OKX_AGENT_ID || '5001',
    x402: paymentGate.status(),
  });
});

app.get('/debug', (_req, res) => {
  res.json({
    hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
    hasModel: !!process.env.OPENROUTER_MODEL,
    publicUrl: PUBLIC_BASE_URL,
    xlayerRpc: (process.env.XLAYER_RPC || 'https://xlayerrpc.okx.com').replace(
      /^https?:\/\//,
      '...'
    ),
    nodeVersion: process.version,
    x402: paymentGate.status(),
  });
});

app.get('/payment-info', (_req, res) => {
  res.json({
    payTo: PAY_TO,
    token: USDT0,
    symbol: 'USD₮0',
    chain: 'XLayer (eip155:196)',
    network: NETWORK,
    amount: PRICE,
    scheme: 'exact',
    sdk: '@okxweb3/x402-express',
    note: 'Unpaid POST /chat returns a standard x402 402 via the OKX Payment SDK.',
  });
});

app.get(
  [
    '/.well-known/agent.json',
    '/.well-known/agent-card.json',
    '/agent-card',
    '/a2a/agent-card',
  ],
  (_req, res) => {
    res.json(agentCard());
  }
);

app.get(['/a2mcp/tools', '/mcp/tools'], (_req, res) => {
  res.json(a2mcpTools());
});

// --- Paid brain: POST /chat (OKX x402 Payment SDK) ---

async function chatHandler(req, res) {
  const { userId, message } = req.body || {};
  if (!userId || !message) {
    return res.status(400).json({ error: 'Both "userId" and "message" are required' });
  }
  try {
    const { text, recIds } = await runObito(userId, message);
    return res.json({ response: text, recIds });
  } catch (err) {
    console.error('/chat LLM error:', err.message, err.stack);
    return res.status(500).json({ error: err.message || 'LLM call failed' });
  }
}

// Internal marketplace worker (loopback / shared secret) skips x402.
// Public clients get the OKX SDK standard 402 challenge when unpaid.
app.post('/chat', (req, res, next) => {
  if (isTrustedInternal(req)) {
    return next();
  }
  if (!paymentGate.configured || !paymentGate.middleware) {
    return res.status(503).json({
      error:
        'x402 Payment SDK not configured. Set OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE on the host.',
    });
  }
  return paymentGate.middleware(req, res, next);
}, chatHandler);

// --- A2A / A2MCP HTTP surface (free — marketplace XMTP uses shim → /chat) ---

app.post(['/a2a/tasks', '/a2a/message'], async (req, res) => {
  try {
    const result = await handleRestTask({ ...req.body, source: 'a2a-rest' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'A2A task failed' });
  }
});

app.get('/a2a/tasks/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json({
    taskId: task.id,
    status: task.state,
    response: task.statusMessage,
    recIds: task.metadata?.recIds || [],
  });
});

app.post(['/a2mcp/invoke', '/mcp/invoke'], async (req, res) => {
  try {
    const result = await handleA2mcpInvoke(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'A2MCP invoke failed' });
  }
});

app.post(['/', '/a2a', '/a2a/jsonrpc'], async (req, res) => {
  const parsed = req.body;
  try {
    if (parsed && parsed.jsonrpc === '2.0' && parsed.method) {
      return res.json(await handleJsonRpc(parsed));
    }
    if (req.path === '/a2a' || req.path === '/a2a/jsonrpc') {
      return res.json(await handleRestTask({ ...parsed, source: 'a2a-rest' }));
    }
    return res.status(404).json({
      error: 'Not found. Use GET / for the site, POST /chat, or A2A JSON-RPC.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'RPC failed' });
  }
});

// --- Static site (Range support for video) ---

app.get(['/preview', '/try'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use(express.static(publicDir, {
  // Let express.static handle ranges for media by default in recent Express.
  acceptRanges: true,
  setHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  },
}));

// Fallback 404 JSON for API-ish paths
app.use((req, res) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    // SPA-ish: unknown paths without extension → index
    if (!path.extname(req.path)) {
      return res.sendFile(path.join(publicDir, 'index.html'));
    }
  }
  res.status(404).json({
    error: 'Not found',
    endpoints: {
      site: 'GET /',
      health: 'GET /health',
      chat: 'POST /chat { userId, message }  (x402-gated via OKX Payment SDK)',
      paymentInfo: 'GET /payment-info',
      agentCard: 'GET /.well-known/agent.json',
      a2aTask: 'POST /a2a/tasks { message, userId? }',
      a2aRpc: 'POST /a2a  JSON-RPC message/send',
      a2mcpTools: 'GET /a2mcp/tools',
      a2mcpInvoke: 'POST /a2mcp/invoke { message, userId? }',
    },
  });
});

app.use((err, _req, res, _next) => {
  console.error('Request error:', err.message);
  console.error('Stack:', err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

async function start() {
  if (paymentGate.configured) {
    try {
      await paymentGate.initialize();
    } catch (err) {
      console.error('[okx-payment] initialize failed:', err.message);
      console.error(
        '[okx-payment] Unpaid /chat will still attempt SDK middleware; fix credentials if 502 appears.'
      );
    }
  } else {
    console.warn(
      '[okx-payment] WARNING: OKX API credentials missing. Public unpaid /chat returns 503 until OKX_API_KEY + OKX_SECRET_KEY + OKX_PASSPHRASE are set.'
    );
  }

  app.listen(PORT, () => {
    console.log(`Shiori listening on port ${PORT}`);
    console.log(`Public URL: ${PUBLIC_BASE_URL}`);
    console.log(`Agent card: ${PUBLIC_BASE_URL.replace(/\/$/, '')}/.well-known/agent.json`);
    console.log(`x402: ${paymentGate.configured ? 'OKX Payment SDK enabled on POST /chat' : 'NOT CONFIGURED'}`);
  });
}

start().catch((err) => {
  console.error('Failed to start Shiori:', err);
  process.exit(1);
});
