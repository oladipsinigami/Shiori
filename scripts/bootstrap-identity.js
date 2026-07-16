#!/usr/bin/env node
/**
 * Restore OnchainOS wallet/session identity onto the Railway volume.
 *
 * Env (base64 of file contents):
 *   ONCHAINOS_SESSION_B64
 *   ONCHAINOS_WALLETS_B64
 *
 * Optional:
 *   ONCHAINOS_HOME  default $HOME/.onchainos  (HOME=/data on Railway)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function decodeB64(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) return null;
  return Buffer.from(String(v).replace(/\s+/g, ''), 'base64');
}

function bootstrap() {
  const home = process.env.HOME || os.homedir() || '/data';
  const onHome = process.env.ONCHAINOS_HOME || path.join(home, '.onchainos');
  const taskHome =
    process.env.OKX_AGENT_TASK_HOME || path.join(home, 'okx-agent-task');

  fs.mkdirSync(onHome, { recursive: true });
  fs.mkdirSync(taskHome, { recursive: true });
  for (const sub of ['logs', 'run', 'sqlite', 'xmtp', 'jobs', 'workspace', 'commands']) {
    fs.mkdirSync(path.join(taskHome, sub), { recursive: true });
  }

  const session = decodeB64('ONCHAINOS_SESSION_B64');
  const wallets = decodeB64('ONCHAINOS_WALLETS_B64');

  if (session) {
    fs.writeFileSync(path.join(onHome, 'session.json'), session);
    console.log('[bootstrap] wrote session.json');
  } else if (!fs.existsSync(path.join(onHome, 'session.json'))) {
    console.warn('[bootstrap] ONCHAINOS_SESSION_B64 missing');
  }

  if (wallets) {
    fs.writeFileSync(path.join(onHome, 'wallets.json'), wallets);
    console.log('[bootstrap] wrote wallets.json');
  } else if (!fs.existsSync(path.join(onHome, 'wallets.json'))) {
    console.warn('[bootstrap] ONCHAINOS_WALLETS_B64 missing');
  }

  // Prefer Shiori Account 1 as selected account if present
  try {
    const wPath = path.join(onHome, 'wallets.json');
    if (fs.existsSync(wPath)) {
      const w = JSON.parse(fs.readFileSync(wPath, 'utf8'));
      const shioriAcct = 'c08d7adc-60cf-41a4-8163-63e822176b43';
      if (w.accountsMap && w.accountsMap[shioriAcct]) {
        w.selectedAccountId = shioriAcct;
        fs.writeFileSync(wPath, JSON.stringify(w));
        console.log('[bootstrap] selectedAccountId set to Shiori Account 1');
      }
    }
  } catch (e) {
    console.warn('[bootstrap] could not pin selected account:', e.message);
  }

  const ready =
    fs.existsSync(path.join(onHome, 'session.json')) &&
    fs.existsSync(path.join(onHome, 'wallets.json'));
  console.log('[bootstrap] ONCHAINOS_HOME=', onHome);
  console.log('[bootstrap] OKX_AGENT_TASK_HOME=', taskHome);
  console.log('[bootstrap] ready=', ready);
  return ready;
}

if (require.main === module) {
  bootstrap();
}

module.exports = { bootstrap };
