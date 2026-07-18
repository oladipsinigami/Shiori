#!/usr/bin/env node
/**
 * Combined Railway entrypoint — runs everything in one container:
 *   1. server.js       → public website + /chat + /health, writes taste memory
 *                         to the /data persistent volume (DATA_DIR=/data).
 *   2. railway-a2a-worker.js → keeps Shiori ONLINE on the OKX.AI marketplace
 *                         (okx-a2a XMTP heartbeats). It reaches the brain
 *                         in-container over SHIORI_URL.
 *
 * server.js owns the public PORT (Railway routes external traffic + health here).
 * The worker binds a separate internal port so the two never collide.
 */
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.join(__dirname, '..');

// Persistent volume for profiles/logs. Railway mounts the volume at /data.
process.env.DATA_DIR = process.env.DATA_DIR || '/data';

// Public port for the brain (website + /chat + /health).
const PORT = process.env.PORT || '8080';

// In-container URL the worker + claude shim use to reach the brain.
const SHIORI_URL = process.env.SHIORI_URL || `http://127.0.0.1:${PORT}`;

const children = [];
let shuttingDown = false;

function launch(name, script, extraEnv) {
  const child = spawn(process.execPath, [path.join(repoRoot, script)], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, SHIORI_URL, ...extraEnv },
  });
  console.log(`[railway-start] launched ${name} (pid ${child.pid})`);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[railway-start] ${name} exited (code=${code} signal=${signal}) — stopping container for restart`);
    shutdown(code == null ? 1 : code);
  });
  children.push(child);
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try { c.kill('SIGTERM'); } catch { /* already gone */ }
  }
  setTimeout(() => process.exit(code), 2000);
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

// Brain owns the public PORT.
launch('server', 'server.js', { PORT });

// Worker gets its own internal port so its health server doesn't collide.
launch('a2a-worker', 'scripts/railway-a2a-worker.js', { PORT: '8091' });
