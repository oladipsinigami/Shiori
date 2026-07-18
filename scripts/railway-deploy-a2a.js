#!/usr/bin/env node
/**
 * Deploy always-on A2A worker to Railway with identity env vars.
 * Reads base64 identity from temp files written by the deploy step.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const token = process.env.RAILWAY_TOKEN;
if (!token) {
  console.error('RAILWAY_TOKEN required');
  process.exit(1);
}

const PROJECT = '45d0c03f-2d1c-473f-bcef-0a8258122450';
const ENV = '16ad35a1-94c3-4558-836a-ab5df57d369c';
const SERVICE = 'ba6c9f99-58b0-4766-91fb-1ffb4bc87b5b';

async function gql(query, variables = {}) {
  const r = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });
  const j = await r.json();
  if (j.errors?.length) {
    throw new Error(j.errors.map((e) => e.message).join('; '));
  }
  return j.data;
}

async function upsert(name, value) {
  await gql(
    `mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }`,
    {
      input: {
        projectId: PROJECT,
        environmentId: ENV,
        serviceId: SERVICE,
        name,
        value
      }
    }
  );
  console.log('set', name, `(${String(value).length} chars)`);
}

async function main() {
  const idDir = process.env.IDENTITY_DIR || path.join(process.env.TEMP || '/tmp', 'shiori-identity');
  const sessionB64 = fs.readFileSync(path.join(idDir, 'session.b64'), 'utf8').trim();
  const walletsB64 = fs.readFileSync(path.join(idDir, 'wallets.b64'), 'utf8').trim();

  // PUBLIC_BASE_URL should be the Railway public domain for this service
  // (agent card + x402 realm). Override via env when deploying.
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || 'https://shiori-h45s.onrender.com';

  const vars = {
    OKX_A2A_ENABLE: '1',
    // Worker reaches the in-container brain served by server.js.
    SHIORI_URL: 'http://127.0.0.1:8080',
    PUBLIC_BASE_URL: publicBaseUrl,
    OKX_AGENT_ID: '5001',
    OKX_AGENT_TASK_HOME: '/data/okx-agent-task',
    HOME: '/data',
    DATA_DIR: '/data',
    ONCHAINOS_HOME: '/data/.onchainos',
    OKX_A2A_AI_PROVIDER: 'claude',
    OKX_A2A_AI_CLAUDE_COMMAND: '/app/scripts/bin/claude',
    KEEP_ALIVE_MS: '240000',
    ONCHAINOS_SESSION_B64: sessionB64,
    ONCHAINOS_WALLETS_B64: walletsB64
  };

  for (const [k, v] of Object.entries(vars)) {
    await upsert(k, v);
  }

  // volume if missing
  try {
    const d = await gql(
      `mutation($input: VolumeCreateInput!) {
        volumeCreate(input: $input) { id name }
      }`,
      {
        input: {
          projectId: PROJECT,
          environmentId: ENV,
          serviceId: SERVICE,
          mountPath: '/data',
          name: 'shiori-a2a-data'
        }
      }
    );
    console.log('volume', JSON.stringify(d));
  } catch (e) {
    console.log('volume create skipped/failed:', e.message);
  }

  // ensure start command
  try {
    await gql(
      `mutation($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) {
        serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input)
      }`,
      {
        environmentId: ENV,
        serviceId: SERVICE,
        input: {
          startCommand: 'node scripts/railway-start.js'
        }
      }
    );
    console.log('start command updated');
  } catch (e) {
    console.log('start command update:', e.message);
  }

  console.log('env ready — run railway up to deploy');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
