#!/usr/bin/env node
/**
 * Railway always-on worker: keeps Shiori ONLINE on OKX.AI marketplace.
 *
 * Online status comes from okx-a2a heartbeats (NOT from Render HTTP).
 * This process:
 *   1. Restores OnchainOS identity from env (base64)
 *   2. Serves GET /health for Railway
 *   3. Runs `okx-a2a run` in the foreground (XMTP + heartbeats)
 *   4. Optionally pings Shiori HTTP brain on Render
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const PORT = Number(process.env.PORT || 8080);
const SHIORI_URL = (process.env.SHIORI_URL || 'https://shiori-h45s.onrender.com').replace(
  /\/$/,
  ''
);
const KEEP_ALIVE_MS = Number(process.env.KEEP_ALIVE_MS || 4 * 60 * 1000);
const A2A_ENABLE =
  process.env.OKX_A2A_ENABLE !== '0' && process.env.OKX_A2A_ENABLE !== 'false';

// Persist under volume when mounted at /data
const HOME = process.env.HOME || '/data';
const TASK_HOME =
  process.env.OKX_AGENT_TASK_HOME || path.join(HOME, 'okx-agent-task');
const SHIM = path.join(__dirname, 'shiori-claude-shim.js');
const CLAUDE_BIN = path.join(__dirname, 'bin', 'claude');

const state = {
  startedAt: new Date().toISOString(),
  lastShioriPing: null,
  lastShioriStatus: null,
  identityReady: false,
  a2a: {
    enabled: A2A_ENABLE,
    attempted: false,
    running: false,
    lastError: null,
    pid: null,
    restarts: 0
  }
};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function which(cmd) {
  const r = spawnSync('bash', ['-lc', `command -v ${cmd} || true`], {
    encoding: 'utf8',
    env: process.env
  });
  const out = (r.stdout || '').trim();
  return out || null;
}

function bootstrapIdentity() {
  process.env.HOME = HOME;
  process.env.OKX_AGENT_TASK_HOME = TASK_HOME;
  try {
    const { bootstrap } = require('./bootstrap-identity.js');
    state.identityReady = Boolean(bootstrap());
  } catch (e) {
    state.identityReady = false;
    log('bootstrap failed:', e.message);
  }
  log('identityReady=', state.identityReady);
  return state.identityReady;
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

function buildEnv() {
  const claudeCmd = fs.existsSync(CLAUDE_BIN) ? CLAUDE_BIN : `node ${SHIM}`;
  return {
    ...process.env,
    HOME,
    PATH: `/app/scripts/bin:/usr/local/bin:/root/.local/bin:${process.env.PATH || ''}`,
    SHIORI_URL,
    OKX_AGENT_TASK_HOME: TASK_HOME,
    OKX_A2A_AI_PROVIDER: 'claude',
    OKX_A2A_AI_CLAUDE_COMMAND: process.env.OKX_A2A_AI_CLAUDE_COMMAND || claudeCmd,
    // Ensure onchainos finds config under HOME
    ONCHAINOS_HOME: path.join(HOME, '.onchainos')
  };
}

let a2aChild = null;
let restartTimer = null;

function startOkxA2a() {
  state.a2a.attempted = true;
  if (!A2A_ENABLE) {
    state.a2a.lastError = 'OKX_A2A_ENABLE is false';
    log(state.a2a.lastError);
    return;
  }
  if (!state.identityReady) {
    state.a2a.lastError =
      'Missing OnchainOS identity (set ONCHAINOS_SESSION_B64 + ONCHAINOS_WALLETS_B64)';
    log(state.a2a.lastError);
    return;
  }

  const env = buildEnv();
  let bin = which('okx-a2a');
  let args = ['run'];
  // Fallback: node CLI module
  if (!bin) {
    const cli = path.join(
      __dirname,
      '..',
      'node_modules',
      '@okxweb3',
      'a2a-node',
      'dist',
      'cli.js'
    );
    if (fs.existsSync(cli)) {
      bin = process.execPath;
      args = [cli, 'run'];
    }
  }
  if (!bin) {
    state.a2a.lastError = 'okx-a2a binary not found';
    log(state.a2a.lastError);
    return;
  }

  // Prefer: okx-a2a run (foreground). If unsupported, daemon start --no-autostart then keep alive.
  log('starting okx-a2a', bin, args.join(' '));
  a2aChild = spawn(bin, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: TASK_HOME
  });
  state.a2a.pid = a2aChild.pid;
  state.a2a.running = true;
  state.a2a.lastError = null;

  a2aChild.stdout.on('data', (d) => process.stdout.write(`[okx-a2a] ${d}`));
  a2aChild.stderr.on('data', (d) => process.stderr.write(`[okx-a2a] ${d}`));
  a2aChild.on('exit', (code, signal) => {
    state.a2a.running = false;
    state.a2a.lastError = `exited code=${code} signal=${signal}`;
    log('okx-a2a exited', state.a2a.lastError);

    // If `run` is unknown, fall back to daemon start once
    if (code !== 0 && state.a2a.restarts === 0 && args[args.length - 1] === 'run') {
      log('retrying with daemon start --provider claude --no-autostart');
      state.a2a.restarts += 1;
      const dArgs =
        bin === process.execPath
          ? [args[0], 'daemon', 'start', '--provider', 'claude', '--no-autostart']
          : ['daemon', 'start', '--provider', 'claude', '--no-autostart'];
      a2aChild = spawn(bin, dArgs, { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: TASK_HOME });
      state.a2a.pid = a2aChild.pid;
      state.a2a.running = true;
      a2aChild.stdout.on('data', (d) => process.stdout.write(`[okx-a2a] ${d}`));
      a2aChild.stderr.on('data', (d) => process.stderr.write(`[okx-a2a] ${d}`));
      a2aChild.on('exit', (c2, s2) => {
        state.a2a.running = false;
        state.a2a.lastError = `daemon exited code=${c2} signal=${s2}`;
        scheduleRestart();
      });
      return;
    }
    scheduleRestart();
  });
}

function scheduleRestart() {
  if (restartTimer) return;
  state.a2a.restarts += 1;
  const delay = Math.min(60_000, 5_000 * state.a2a.restarts);
  log(`scheduling okx-a2a restart in ${delay}ms (attempt ${state.a2a.restarts})`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startOkxA2a();
  }, delay);
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    // Always 200 so Railway does not kill the container while okx-a2a restarts.
    // Marketplace online is tracked via a2a.running + onchain heartbeats.
    const marketplaceOnline = Boolean(state.identityReady && state.a2a.running);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(
        {
          status: 'ok',
          marketplaceOnline,
          role: 'shiori-a2a-worker',
          shioriUrl: SHIORI_URL,
          home: HOME,
          taskHome: TASK_HOME,
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
  log(`HOME=${HOME} TASK_HOME=${TASK_HOME}`);
  bootstrapIdentity();
  pingShiori();
  setInterval(pingShiori, KEEP_ALIVE_MS);
  startOkxA2a();
});
