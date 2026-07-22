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
  createA2mcpPaymentGate,
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
const a2mcpPaymentGate = createA2mcpPaymentGate();

// --- Health / debug / discovery (free) ---

app.get(['/health', '/ready'], (_req, res) => {
  res.json({
    status: 'ok',
    service: 'shiori',
    a2a: true,
    publicUrl: PUBLIC_BASE_URL,
    okxAgentId: process.env.OKX_AGENT_ID || '5001',
    x402: paymentGate.status(),
    a2mcp_x402: a2mcpPaymentGate.status(),
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
    a2mcp_x402: a2mcpPaymentGate.status(),
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

// When this host has no OKX Payment keys (e.g. free Render), forward /chat to the
// Railway brain that does. Preserve Host / X-Forwarded-* so the 402 `resource`
// still matches the public listing URL (shiori-h45s.onrender.com).
const X402_PEER_URL = (
  process.env.X402_PEER_URL ||
  'https://shiori-a2a-worker-production.up.railway.app'
).replace(/\/$/, '');

async function proxyChatToPeer(req, res) {
  const target = `${X402_PEER_URL}/chat`;
  const publicHost =
    (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  const publicProto =
    (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();

  const headers = {
    'content-type': req.get('content-type') || 'application/json',
    accept: req.get('accept') || 'application/json',
  };
  // Payment headers (exact / charge clients)
  for (const name of [
    'x-payment',
    'payment-signature',
    'payment-required',
    'authorization',
    'x-shiori-internal-key',
  ]) {
    const v = req.get(name);
    if (v) headers[name] = v;
  }
  // Make the peer issue a challenge for THIS public host (listing URL).
  if (publicHost) {
    headers.host = publicHost;
    headers['x-forwarded-host'] = publicHost;
    headers['x-forwarded-proto'] = publicProto || 'https';
  }

  const body =
    req.body && Object.keys(req.body).length
      ? JSON.stringify(req.body)
      : undefined;

  console.log(`[x402-proxy] ${req.method} /chat → ${target} (host=${publicHost || '?'})`);

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers,
      body,
    });
    const text = await upstream.text();
    // Relay status + payment-related headers
    res.status(upstream.status);
    for (const h of [
      'content-type',
      'payment-required',
      'payment-response',
      'x-payment-response',
      'www-authenticate',
      'access-control-expose-headers',
    ]) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.send(text);
  } catch (err) {
    console.error('[x402-proxy] failed:', err.message);
    return res.status(502).json({
      error: `x402 peer proxy failed: ${err.message}`,
      peer: X402_PEER_URL,
    });
  }
}

async function chatHandler(req, res) {
  const { userId, message } = req.body || {};
  if (!userId || !message) {
    return res.status(400).json({ error: 'Both "userId" and "message" are required' });
  }
  try {
    const { text, recIds } = await runObito(userId, message);
    const sessionId = `shiori-${userId.slice(0, 16)}-${Date.now().toString(36)}`;
    return res.json({ response: text, recIds, sessionId });
  } catch (err) {
    console.error('/chat LLM error:', err.message, err.stack);
    return res.status(500).json({ error: err.message || 'LLM call failed' });
  }
}

// Internal marketplace worker (loopback / shared secret) skips x402.
// Public clients get the OKX SDK standard 402 challenge when unpaid.
app.post('/chat', async (req, res, next) => {
  if (isTrustedInternal(req)) {
    return next();
  }
  if (!paymentGate.configured || !paymentGate.middleware) {
    // Render (or any host without OKX SA keys) → Railway peer that has them.
    return proxyChatToPeer(req, res);
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

async function a2mcpMiddleware(req, res, next) {
  if (res.headersSent) return;
  if (isTrustedInternal(req)) {
    return next();
  }
  if (!a2mcpPaymentGate.configured || !a2mcpPaymentGate.middleware) {
    return res.status(503).json({
      error:
        'x402 Payment SDK not configured. Set OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE on the host.',
    });
  }
  // The SDK middleware / charge fallback will either call next() on
  // verified payment or send a 402 response directly.
  return a2mcpPaymentGate.middleware(req, res, next);
}

app.post(['/a2mcp/invoke', '/mcp/invoke'], a2mcpMiddleware, async (req, res) => {
  if (res.headersSent) return;
  try {
    const result = await handleA2mcpInvoke(req.body);
    if (res.headersSent) return;
    res.json(result);
  } catch (err) {
    if (res.headersSent) return;
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
  for (const [label, gate] of [
    ['chat', paymentGate],
    ['a2mcp', a2mcpPaymentGate],
  ]) {
    if (gate.configured) {
      try {
        await gate.initialize();
      } catch (err) {
        console.error(`[okx-payment] ${label} initialize failed:`, err.message);
      }
    } else {
      console.warn(
        `[okx-payment] ${label}: OKX API credentials missing. Unpaid requests return 503 until OKX_API_KEY + OKX_SECRET_KEY + OKX_PASSPHRASE are set.`
      );
    }
  }

  app.listen(PORT, () => {
    console.log(`Shiori listening on port ${PORT}`);
    console.log(`Public URL: ${PUBLIC_BASE_URL}`);
    console.log(`Agent card: ${PUBLIC_BASE_URL.replace(/\/$/, '')}/.well-known/agent.json`);
    console.log(
      `x402 /chat:  ${paymentGate.configured ? 'SDK enabled (exact)' : 'fallback charge model'}`
    );
    console.log(
      `x402 /a2mcp: ${a2mcpPaymentGate.configured ? 'SDK enabled (exact)' : 'fallback charge model'}`
    );
  });
}

start().catch((err) => {
  console.error('Failed to start Shiori:', err);
  process.exit(1);
});
