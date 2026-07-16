require('dotenv').config();
const http = require('http');
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
  PUBLIC_BASE_URL
} = require('./a2a');
const { generateChallenge, verifyPayment, SHIORI_WALLET, USDT_ADDRESS, FEE_HUMAN } = require('./x402');

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function sendJson(res, status, body, extraHeaders) {
  const payload = JSON.stringify(body);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-payment, x-payment-address',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(payload);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*'
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseJsonSafe(raw) {
  if (!raw || !raw.trim()) return {};
  return JSON.parse(raw);
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = decodeURIComponent(rel.split('?')[0]);
  if (rel.includes('..')) {
    return sendJson(res, 400, { error: 'Invalid path' });
  }

  const filePath = path.join(publicDir, rel);
  if (!filePath.startsWith(publicDir)) {
    return sendJson(res, 400, { error: 'Invalid path' });
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-payment, x-payment-address',
    });
    return res.end();
  }

  try {
    if (req.method === 'GET' && (pathname === '/health' || pathname === '/ready')) {
      return sendJson(res, 200, {
        status: 'ok',
        service: 'shiori',
        a2a: true,
        publicUrl: PUBLIC_BASE_URL,
        okxAgentId: process.env.OKX_AGENT_ID || '5001'
      });
    }

    if (req.method === 'GET' && pathname === '/debug') {
      return sendJson(res, 200, {
        hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
        hasModel: !!process.env.OPENROUTER_MODEL,
        publicUrl: PUBLIC_BASE_URL,
        xlayerRpc: (process.env.XLAYER_RPC || 'https://xlayerrpc.okx.com').replace(/^https?:\/\//, '...'),
        nodeVersion: process.version,
      });
    }

    if (req.method === 'GET' && pathname === '/payment-info') {
      return sendJson(res, 200, {
        payTo: SHIORI_WALLET,
        token: USDT_ADDRESS,
        chain: 'XLayer (eip155:196)',
        amount: FEE_HUMAN,
        symbol: 'USDT',
      });
    }

    if (
      req.method === 'GET' &&
      (pathname === '/.well-known/agent.json' ||
        pathname === '/.well-known/agent-card.json' ||
        pathname === '/agent-card' ||
        pathname === '/a2a/agent-card')
    ) {
      return sendJson(res, 200, agentCard());
    }

    if (req.method === 'GET' && (pathname === '/a2mcp/tools' || pathname === '/mcp/tools')) {
      return sendJson(res, 200, a2mcpTools());
    }

    if (req.method === 'POST' && pathname === '/chat') {
      const xPayment = req.headers['x-payment'];

      if (xPayment) {
        const payResult = await verifyPayment(xPayment);
        if (!payResult.valid) {
          return sendJson(res, 402, {
            error: 'Payment verification failed',
            detail: payResult.reason,
          });
        }
      } else {
        const { headerValue, challenge } = generateChallenge();
        return sendJson(res, 402, {
          error: 'Payment required',
          payment: challenge,
        }, { 'PAYMENT-REQUIRED': headerValue });
      }

      const raw = await readBody(req);
      let parsed;
      try {
        parsed = parseJsonSafe(raw);
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }
      const { userId, message } = parsed;
      if (!userId || !message) {
        return sendJson(res, 400, { error: 'Both "userId" and "message" are required' });
      }
      try {
        const { text, recIds } = await runObito(userId, message);
        return sendJson(res, 200, { response: text, recIds });
      } catch (err) {
        console.error('/chat LLM error:', err.message, err.stack);
        return sendJson(res, 500, { error: err.message || 'LLM call failed' });
      }
    }

    if (req.method === 'POST' && (pathname === '/a2a/tasks' || pathname === '/a2a/message')) {
      const raw = await readBody(req);
      let parsed;
      try {
        parsed = parseJsonSafe(raw);
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }
      const result = await handleRestTask({ ...parsed, source: 'a2a-rest' });
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' && pathname.startsWith('/a2a/tasks/')) {
      const id = pathname.slice('/a2a/tasks/'.length);
      const task = getTask(id);
      if (!task) return sendJson(res, 404, { error: 'Task not found' });
      return sendJson(res, 200, {
        taskId: task.id,
        status: task.state,
        response: task.statusMessage,
        recIds: task.metadata?.recIds || []
      });
    }

    if (req.method === 'POST' && (pathname === '/a2mcp/invoke' || pathname === '/mcp/invoke')) {
      const raw = await readBody(req);
      let parsed;
      try {
        parsed = parseJsonSafe(raw);
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }
      const result = await handleA2mcpInvoke(parsed);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && (pathname === '/' || pathname === '/a2a' || pathname === '/a2a/jsonrpc')) {
      const raw = await readBody(req);
      let parsed;
      try {
        parsed = parseJsonSafe(raw);
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }

      if (parsed && parsed.jsonrpc === '2.0' && parsed.method) {
        const rpc = await handleJsonRpc(parsed);
        return sendJson(res, 200, rpc);
      }

      if (pathname === '/a2a' || pathname === '/a2a/jsonrpc') {
        const result = await handleRestTask({ ...parsed, source: 'a2a-rest' });
        return sendJson(res, 200, result);
      }

      return sendJson(res, 404, {
        error: 'Not found. Use GET / for the site, POST /chat, or A2A JSON-RPC.'
      });
    }

    if (req.method === 'GET') {
      if (serveStatic(req, res, pathname)) return;
      if (pathname === '/preview' || pathname === '/try') {
        if (serveStatic(req, res, '/index.html')) return;
      }
    }

    return sendJson(res, 404, {
      error: 'Not found',
      endpoints: {
        site: 'GET /',
        health: 'GET /health',
        chat: 'POST /chat { userId, message }',
        paymentInfo: 'GET /payment-info',
        agentCard: 'GET /.well-known/agent.json',
        a2aTask: 'POST /a2a/tasks { message, userId? }',
        a2aRpc: 'POST /a2a  JSON-RPC message/send',
        a2mcpTools: 'GET /a2mcp/tools',
        a2mcpInvoke: 'POST /a2mcp/invoke { message, userId? }'
      }
    });
  } catch (err) {
    console.error('Request error:', err.message);
    console.error('Stack:', err.stack);
    const status = err.status || 500;
    return sendJson(res, status, {
      error: err.message || 'Internal error'
    });
  }
});

server.listen(PORT, () => {
  console.log(`Shiori listening on port ${PORT}`);
  console.log(`Public URL: ${PUBLIC_BASE_URL}`);
  console.log(`Agent card: ${PUBLIC_BASE_URL.replace(/\/$/, '')}/.well-known/agent.json`);
});
