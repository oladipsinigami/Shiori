#!/usr/bin/env node
/**
 * Restore OnchainOS identity onto the Railway volume.
 *
 * IMPORTANT: session.json is device/TEE-bound. A session created on your
 * laptop CANNOT be copied to Railway — onchainos will report "session expired".
 * Login must happen *inside* the container (see ONCHAINOS_DO_LOGIN / ONCHAINOS_OTP).
 *
 * Env:
 *   ONCHAINOS_WALLETS_B64     optional account map restore (safe-ish)
 *   ONCHAINOS_SESSION_B64     only applied if no session on volume, or FORCE_RESTORE=1
 *   ONCHAINOS_FORCE_RESTORE=1 overwrite volume session with SESSION_B64 (usually wrong)
 *   ONCHAINOS_DO_LOGIN=1      run `onchainos wallet login <email> --force` (sends OTP)
 *   ONCHAINOS_LOGIN_EMAIL     default oladipupos111@gmail.com
 *   ONCHAINOS_OTP             if set, run `onchainos wallet verify <otp>` on this machine
 *   ONCHAINOS_HOME            default $HOME/.onchainos
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function decodeB64(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) return null;
  return Buffer.from(String(v).replace(/\s+/g, ''), 'base64');
}

function whichOnchainos() {
  const r = spawnSync('bash', ['-lc', 'command -v onchainos || true'], {
    encoding: 'utf8',
    env: process.env,
  });
  const p = (r.stdout || '').trim();
  return p || null;
}

function runOnchainos(args, env) {
  const bin = whichOnchainos() || 'onchainos';
  console.log('[bootstrap] onchainos', args.join(' '));
  const r = spawnSync(bin, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 120_000,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error) console.error('[bootstrap] onchainos spawn error:', r.error.message);
  console.log('[bootstrap] onchainos exit', r.status);
  return r;
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

  const sessionPath = path.join(onHome, 'session.json');
  const walletsPath = path.join(onHome, 'wallets.json');
  const forceRestore =
    process.env.ONCHAINOS_FORCE_RESTORE === '1' ||
    process.env.ONCHAINOS_FORCE_RESTORE === 'true';

  // Wallets: safe to restore account map from env if missing.
  const wallets = decodeB64('ONCHAINOS_WALLETS_B64');
  if (wallets && (forceRestore || !fs.existsSync(walletsPath))) {
    fs.writeFileSync(walletsPath, wallets);
    console.log('[bootstrap] wrote wallets.json');
  } else if (!fs.existsSync(walletsPath)) {
    console.warn('[bootstrap] wallets.json missing and ONCHAINOS_WALLETS_B64 not set');
  } else {
    console.log('[bootstrap] keeping existing wallets.json on volume');
  }

  // Session: NEVER clobber a volume session with a foreign machine's session
  // unless FORCE_RESTORE. Foreign sessions look valid on disk but fail API auth.
  const session = decodeB64('ONCHAINOS_SESSION_B64');
  if (session && (forceRestore || !fs.existsSync(sessionPath))) {
    fs.writeFileSync(sessionPath, session);
    console.log(
      forceRestore
        ? '[bootstrap] FORCE wrote session.json from ONCHAINOS_SESSION_B64'
        : '[bootstrap] wrote session.json (none on volume)'
    );
  } else if (fs.existsSync(sessionPath)) {
    console.log(
      '[bootstrap] keeping existing session.json on volume (device-bound; not overwriting from laptop B64)'
    );
  } else {
    console.warn('[bootstrap] no session.json on volume — need in-container login');
  }

  // Prefer Shiori Account 1 as selected account if present
  try {
    if (fs.existsSync(walletsPath)) {
      const w = JSON.parse(fs.readFileSync(walletsPath, 'utf8'));
      const shioriAcct = 'c08d7adc-60cf-41a4-8163-63e822176b43';
      if (w.accountsMap && w.accountsMap[shioriAcct]) {
        w.selectedAccountId = shioriAcct;
        fs.writeFileSync(walletsPath, JSON.stringify(w));
        console.log('[bootstrap] selectedAccountId set to Shiori Account 1');
      }
    }
  } catch (e) {
    console.warn('[bootstrap] could not pin selected account:', e.message);
  }

  const env = {
    HOME: home,
    ONCHAINOS_HOME: onHome,
    OKX_AGENT_TASK_HOME: taskHome,
  };

  // In-container login: must run where okx-pilot TEE lives (Railway), not on laptop.
  const email =
    process.env.ONCHAINOS_LOGIN_EMAIL ||
    process.env.ONCHAINOS_EMAIL ||
    'oladipupos111@gmail.com';
  const doLogin =
    process.env.ONCHAINOS_DO_LOGIN === '1' || process.env.ONCHAINOS_DO_LOGIN === 'true';
  const otp = (process.env.ONCHAINOS_OTP || '').trim();

  if (doLogin || otp) {
    runOnchainos(['wallet', 'login', '--help'], env);
    runOnchainos(['wallet', 'verify', '--help'], env);
  }

  if (doLogin) {
    // Prefer API-key login when OKX_API_KEY / SECRET / PASSPHRASE are present
    // (no OTP, works inside the container). Fall back to email OTP otherwise.
    const hasAk =
      process.env.OKX_API_KEY &&
      (process.env.OKX_SECRET_KEY || process.env.OKX_API_SECRET) &&
      (process.env.OKX_PASSPHRASE || process.env.OKX_API_PASSPHRASE);

    // Map OKX_API_SECRET → OKX_SECRET_KEY for onchainos AK login naming.
    if (process.env.OKX_API_SECRET && !process.env.OKX_SECRET_KEY) {
      env.OKX_SECRET_KEY = process.env.OKX_API_SECRET;
    }
    if (process.env.OKX_API_PASSPHRASE && !process.env.OKX_PASSPHRASE) {
      env.OKX_PASSPHRASE = process.env.OKX_API_PASSPHRASE;
    }

    if (hasAk) {
      console.log('[bootstrap] ONCHAINOS_DO_LOGIN=1 → API Key login (no OTP)');
      // Clear foreign session first so AK login can write a native container session.
      if (
        process.env.ONCHAINOS_CLEAR_SESSION === '1' ||
        process.env.ONCHAINOS_CLEAR_SESSION === 'true'
      ) {
        try {
          if (fs.existsSync(sessionPath)) {
            fs.unlinkSync(sessionPath);
            console.log('[bootstrap] cleared old session.json before AK login');
          }
        } catch (e) {
          console.warn('[bootstrap] could not clear session:', e.message);
        }
      }
      const akAttempts = [
        ['wallet', 'login', '--force'],
        ['wallet', 'login'],
      ];
      let loginOk = false;
      for (const args of akAttempts) {
        const r = runOnchainos(args, env);
        if (r.status === 0) {
          loginOk = true;
          console.log('[bootstrap] AK login succeeded with:', args.join(' '));
          break;
        }
      }
      if (!loginOk) console.error('[bootstrap] AK login failed');
      runOnchainos(['wallet', 'status'], env);
      runOnchainos(['agent', 'get', '--page', '1', '--page-size', '5'], env);
    } else {
      console.log('[bootstrap] ONCHAINOS_DO_LOGIN=1 → email OTP login for', email);
      const loginAttempts = [
        ['wallet', 'login', email, '--force', '--locale', 'en_US'],
        ['wallet', 'login', '--email', email, '--force', '--locale', 'en_US'],
        ['wallet', 'login', '--force', email],
        ['wallet', 'login', email, '--force'],
        ['wallet', 'login', email],
      ];
      let loginOk = false;
      for (const args of loginAttempts) {
        const r = runOnchainos(args, env);
        if (r.status === 0) {
          loginOk = true;
          console.log('[bootstrap] email login succeeded with:', args.join(' '));
          break;
        }
      }
      if (!loginOk) console.error('[bootstrap] all email login attempts failed');
    }
  }

  if (otp) {
    console.log('[bootstrap] ONCHAINOS_OTP set → verifying OTP on this host');
    // Drop foreign/laptop session so verify can write a container-native one.
    if (
      process.env.ONCHAINOS_CLEAR_SESSION === '1' ||
      process.env.ONCHAINOS_CLEAR_SESSION === 'true'
    ) {
      try {
        if (fs.existsSync(sessionPath)) {
          fs.unlinkSync(sessionPath);
          console.log('[bootstrap] cleared old session.json before verify');
        }
      } catch (e) {
        console.warn('[bootstrap] could not clear session:', e.message);
      }
    }
    const verifyAttempts = [
      ['wallet', 'verify', otp],
      ['wallet', 'verify', '--otp', otp],
      ['wallet', 'login', 'verify', otp],
    ];
    let verifyOk = false;
    for (const args of verifyAttempts) {
      const r = runOnchainos(args, env);
      if (r.status === 0) {
        verifyOk = true;
        console.log('[bootstrap] verify succeeded with:', args.join(' '));
        break;
      }
    }
    if (!verifyOk) console.error('[bootstrap] all verify attempts failed');
    // Smoke-check
    runOnchainos(['wallet', 'status'], env);
    runOnchainos(['agent', 'get', '--page', '1', '--page-size', '5'], env);
  }

  const ready = fs.existsSync(sessionPath) && fs.existsSync(walletsPath);
  console.log('[bootstrap] ONCHAINOS_HOME=', onHome);
  console.log('[bootstrap] OKX_AGENT_TASK_HOME=', taskHome);
  console.log('[bootstrap] ready=', ready);
  return ready;
}

if (require.main === module) {
  bootstrap();
}

module.exports = { bootstrap };
