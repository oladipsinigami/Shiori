#!/usr/bin/env node
/**
 * Always-on Railway worker for Shiori A2A presence support.
 *
 * What it does:
 *  1. Serves GET /health on $PORT (Railway liveness)
 *  2. Periodically pings Shiori on Render so free-tier cold starts are rarer
 *  3. Optionally starts okx-a2a with the Claude→Shiori shim when enabled
 *
 * Env:
 *   SHIORI_URL              default https://shiori-h45s.onrender.com
 *   KEEP_ALIVE_MS           default 240000 (4 min)
 *   OKX_A2A_ENABLE          "1" to attempt starting okx-a2a daemon
 *   OKX_A2A_AI_CLAUDE_COMMAND  optional override
 *   OKX_AGENT_TASK_HOME     data dir (mount a volume here, e.g. /data)
 *   PORT                    Railway-provided
 */

const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PORT = Number(process.env.PORT || 8080);
const SHIORI_URL = (process.env.SHIORI_URL || 'https://shiori-h45s.onrender.com').replace(
  /\/$/,
  ''
);
const KEEP_ALIVE_MS = Number(process.env.KEEP_ALIVE_MS || 4 * 60 * 1000);
const A2A_ENABLE = process.env.OKX_A2A_ENABLE === '1' || process.env.OKX_A2A_ENABLE === 'true';
const HOME_DIR = process.env.OKX_AGENT_TASK_HOME || process.env.HOME || '/data';
const SHIM = path.join(__dirname, 'shiori-claude-shim.js');

const state = {
  startedAt: new Date().toISOString(),
  lastShioriPing: null,
  lastShioriStatus: null,
  a2a: {
    enabled: A2A_ENABLE,
    attempted: false,
    running: false,
    lastError: null,
    pid: null
  }
};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function pingShiori() {
  try {
    const res = await fetch(`${SHIORI_URL}/health`, { cache: 'no-store' });
    const body = await res.text();
    state.lastShioriPing = new Date().toISOString();
    state.lastShioriStatus = `${res.status} ${body.slice(0, 120)}`;
    log('shiori ping', state.lastShioriStatus);
  } catch (err) {
    state.lastShioriPing = new Date().toISOString();
    state.lastShioriStatus = `error: ${err.message}`;
    log('shiori ping failed', err.message);
  }
}

function which(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
    encoding: 'utf8'
  });
  return r.status === 0 ? (r.stdout || '').split(/\r?\n/)[0].trim() : null;
}

function startOkxA2a() {
  state.a2a.attempted = true;
  if (!A2A_ENABLE) {
    log('okx-a2a disabled (set OKX_A2A_ENABLE=1 after agent identity is on this volume)');
    return;
  }

  const bin = which('okx-a2a');
  if (!bin) {
    state.a2a.lastError = 'okx-a2a not found on PATH (npm i -g @okxweb3/a2a-node)';
    log(state.a2a.lastError);
    return;
  }

  const env = {
    ...process.env,
    SHIORI_URL,
    OKX_AGENT_TASK_HOME: HOME_DIR,
    OKX_A2A_AI_CLAUDE_COMMAND: process.env.OKX_A2A_AI_CLAUDE_COMMAND || `node ${SHIM}`
  };

  log('starting okx-a2a daemon via', bin);
  // Prefer foreground-ish run so Railway supervises something real.
  // `daemon start` may detach; try `run` if present, else daemon start.
  const child = spawn(bin, ['daemon', 'start', '--provider', 'claude', '--no-autostart'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  state.a2a.pid = child.pid;
  state.a2a.running = true;
  child.stdout.on('data', (d) => process.stdout.write(`[okx-a2a] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[okx-a2a] ${d}`));
  child.on('exit', (code, signal) => {
    state.a2a.running = false;
    state.a2a.lastError = `exited code=${code} signal=${signal}`;
    log('okx-a2a exited', state.a2a.lastError);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(
        {
          status: 'ok',
          role: 'shiori-a2a-worker',
          shioriUrl: SHIORI_URL,
          ...state
        },
        null,
        2
      )
    );
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  log(`a2a worker listening on :${PORT}`);
  log(`SHIORI_URL=${SHIORI_URL}`);
  log(`OKX_A2A_ENABLE=${A2A_ENABLE}`);
  pingShiori();
  setInterval(pingShiori, KEEP_ALIVE_MS);
  startOkxA2a();
});
