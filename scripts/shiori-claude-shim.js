#!/usr/bin/env node
/**
 * Claude CLI shim for okx-a2a daemon.
 *
 * okx-a2a dispatches A2A XMTP jobs by spawning:
 *   claude --print "<prompt>"
 *   claude --resume <sessionId> --print "<prompt>"
 *
 * Point the daemon at this shim so marketplace hires run through Shiori:
 *
 *   set OKX_A2A_AI_CLAUDE_COMMAND=node C:\path\to\shiori\scripts\shiori-claude-shim.js
 *   okx-a2a daemon start --provider claude --no-autostart
 *
 * Env:
 *   SHIORI_URL   default https://shiori-h45s.onrender.com
 *   SHIORI_USER_ID  optional fixed user id (default derives from resume/session)
 */

const SHIORI_URL = (process.env.SHIORI_URL || 'https://shiori-h45s.onrender.com').replace(/\/$/, '');

function parseArgs(argv) {
  const args = argv.slice(2);
  let resume = null;
  let print = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--resume' || a === 'resume') {
      resume = args[++i] || null;
      continue;
    }
    if (a === '--print' || a === '-p') {
      // Claude accepts: --print <prompt>  OR  --print  with prompt as next non-flag
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        print = next;
        i++;
      }
      continue;
    }
    // Some CLIs put the prompt as the last bare arg
    if (!a.startsWith('-') && print === null) {
      // keep last bare string as candidate prompt
      print = a;
    }
  }

  // If --print was last with no value, use remaining joined text
  if (print === null) {
    const bare = args.filter((a) => !a.startsWith('-') && a !== 'resume');
    if (bare.length) print = bare[bare.length - 1];
  }

  return { resume, print };
}

function userIdFrom(resume, prompt) {
  if (process.env.SHIORI_USER_ID) return process.env.SHIORI_USER_ID;
  if (resume) return `okx-${String(resume).slice(0, 48)}`;
  // Try to stabilize on job ids embedded in prompts
  const m = String(prompt || '').match(/job[_-]?id[:\s]+([a-zA-Z0-9_-]+)/i);
  if (m) return `okx-job-${m[1]}`;
  return 'okx-a2a-user';
}

async function main() {
  const { resume, print } = parseArgs(process.argv);
  if (!print || !String(print).trim()) {
    console.error('shiori-claude-shim: missing --print prompt');
    process.exit(2);
  }

  const userId = userIdFrom(resume, print);
  const message = String(print).trim();

  // Marketplace XMTP → brain must not hit public x402. Loopback is trusted by
  // server.js; optional SHIORI_INTERNAL_KEY covers non-loopback SHIORI_URL hops.
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.SHIORI_INTERNAL_KEY) {
    headers['X-Shiori-Internal-Key'] = process.env.SHIORI_INTERNAL_KEY;
  }

  const res = await fetch(`${SHIORI_URL}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ userId, message })
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`shiori-claude-shim: upstream ${res.status}: ${errText}`);
    process.exit(1);
  }

  const data = await res.json();
  const text = data.response || data.text || '';

  // okx-a2a daemon parses sessionId from stdout line matching /^session_id:\s*(\S+)/
  // or from stream-json events: {"type":"system","subtype":"init","session_id":"<id>"}
  // We use the text format for simplicity.
  if (!resume) {
    const sessionId = data.sessionId || `s${Date.now().toString(36)}${String(Math.random()).slice(2, 10)}`;
    process.stdout.write(`session_id: ${sessionId}\n`);
  }
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

main().catch((err) => {
  console.error('shiori-claude-shim:', err.message || err);
  process.exit(1);
});
