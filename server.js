require('dotenv').config();
const http = require('http');
const { runObito } = require('./obito-core');

const PORT = process.env.PORT || 3000;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  // Basic CORS preflight support
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, { status: 'ok' });
  }

  if (req.method === 'POST' && req.url === '/chat') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
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
    });
    return;
  }

  sendJson(res, 404, { error: 'Not found. POST /chat with { "userId": "...", "message": "..." }' });
});

server.listen(PORT, () => {
  console.log(`Obito server listening on port ${PORT}`);
});
