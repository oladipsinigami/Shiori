require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { runObito } = require('./obito-core');
const { generateChallenge, verifyPayment, SHIORI_WALLET, USDT_ADDRESS, FEE_HUMAN } = require('./x402');

const PORT = process.env.PORT || 3000;

function sendJson(res, status, body, extraHeaders) {
  const payload = JSON.stringify(body);
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(payload);
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data));
  });
}

function serveStatic(res, filePath, contentType) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-payment, x-payment-address',
    });
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, { status: 'ok' });
  }

  if (req.method === 'GET' && req.url === '/') {
    return serveStatic(res, path.join(__dirname, 'public', 'index.html'), 'text/html');
  }

  if (req.method === 'GET' && req.url === '/payment-info') {
    return sendJson(res, 200, {
      payTo: SHIORI_WALLET,
      token: USDT_ADDRESS,
      chain: 'XLayer (eip155:196)',
      amount: FEE_HUMAN,
      symbol: 'USDT',
    });
  }

  if (req.method === 'POST' && req.url === '/chat') {
    const xPayment = req.headers['x-payment'];

    if (xPayment) {
      verifyPayment(xPayment).then(async result => {
        if (!result.valid) {
          return sendJson(res, 402, {
            error: 'Payment verification failed',
            detail: result.reason,
          });
        }

        const body = await readBody(req);
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          return sendJson(res, 400, { error: 'Invalid JSON body' });
        }

        const { userId, message } = parsed;
        if (!userId || !message) {
          return sendJson(res, 400, { error: 'Both "userId" and "message" are required' });
        }

        try {
          const { text, recIds } = await runObito(userId, message);
          sendJson(res, 200, { response: text, recIds });
        } catch (err) {
          console.error('Error in /chat:', err.message);
          sendJson(res, 500, { error: 'Internal error generating response' });
        }
      }).catch(err => {
        sendJson(res, 500, { error: 'Payment verification error' });
      });
      return;
    }

    const { headerValue, challenge } = generateChallenge();
    sendJson(res, 402, {
      error: 'Payment required',
      payment: challenge,
    }, {
      'PAYMENT-REQUIRED': headerValue,
    });
    return;
  }

  sendJson(res, 404, { error: 'Not found. POST /chat with { "userId": "...", "message": "..." }' });
});

server.listen(PORT, () => {
  console.log(`Obito server listening on port ${PORT}`);
});
