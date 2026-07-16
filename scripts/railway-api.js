#!/usr/bin/env node
/**
 * Small Railway GraphQL helper.
 * Usage:
 *   set RAILWAY_TOKEN=...
 *   node scripts/railway-api.js <command>
 */
const token = process.env.RAILWAY_TOKEN;
if (!token) {
  console.error('RAILWAY_TOKEN required');
  process.exit(1);
}

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
    const err = new Error(j.errors.map((e) => e.message).join('; '));
    err.details = j.errors;
    throw err;
  }
  return j.data;
}

const cmd = process.argv[2] || 'whoami';

async function main() {
  if (cmd === 'whoami') {
    const d = await gql(`query { me { id email } }`);
    console.log(JSON.stringify(d.me, null, 2));
    return;
  }

  if (cmd === 'mutations') {
    const d = await gql(`query { __type(name: "Mutation") { fields { name } } }`);
    const names = d.__type.fields
      .map((f) => f.name)
      .filter((n) =>
        /project|service|deploy|variable|volume|environment|github|repo|workspace|domain/i.test(
          n
        )
      )
      .sort();
    console.log(names.join('\n'));
    return;
  }

  if (cmd === 'projects') {
    const d = await gql(`
      query {
        me {
          workspaces {
            id
            name
            team { id name }
            projects { edges { node { id name } } }
          }
        }
      }
    `);
    console.log(JSON.stringify(d.me.workspaces, null, 2));
    return;
  }

  if (cmd === 'create-project') {
    const name = process.argv[3] || 'shiori-a2a';
    const workspaceId = process.argv[4];
    let d;
    try {
      d = await gql(
        `mutation($input: ProjectCreateInput!) {
          projectCreate(input: $input) {
            id
            name
          }
        }`,
        {
          input: workspaceId
            ? { name, workspaceId }
            : { name }
        }
      );
    } catch (e1) {
      console.error('projectCreate typed failed:', e1.message);
      d = await gql(
        `mutation($name: String!) {
          projectCreate(input: { name: $name }) {
            id
            name
          }
        }`,
        { name }
      );
    }
    console.log(JSON.stringify(d.projectCreate, null, 2));
    return;
  }

  if (cmd === 'project') {
    const id = process.argv[3];
    const d = await gql(
      `query($id: String!) {
        project(id: $id) {
          id
          name
          environments { edges { node { id name } } }
          services { edges { node { id name } } }
        }
      }`,
      { id }
    );
    console.log(JSON.stringify(d.project, null, 2));
    return;
  }

  if (cmd === 'service-create') {
    const projectId = process.argv[3];
    const name = process.argv[4] || 'shiori-a2a-worker';
    const d = await gql(
      `mutation($input: ServiceCreateInput!) {
        serviceCreate(input: $input) {
          id
          name
        }
      }`,
      { input: { projectId, name } }
    );
    console.log(JSON.stringify(d.serviceCreate, null, 2));
    return;
  }

  if (cmd === 'service-connect') {
    // serviceConnect(id, input: { repo, branch? })
    const serviceId = process.argv[3];
    const repo = process.argv[4] || 'oladipsinigami/Shiori';
    const branch = process.argv[5] || 'master';
    let d;
    try {
      d = await gql(
        `mutation($id: String!, $input: ServiceConnectInput!) {
          serviceConnect(id: $id, input: $input) {
            id
            name
          }
        }`,
        { id: serviceId, input: { repo, branch } }
      );
    } catch (e) {
      console.error('serviceConnect failed:', e.message);
      d = await gql(
        `mutation($id: String!, $repo: String!) {
          serviceConnect(id: $id, input: { repo: $repo }) {
            id
            name
          }
        }`,
        { id: serviceId, repo }
      );
    }
    console.log(JSON.stringify(d.serviceConnect, null, 2));
    return;
  }

  if (cmd === 'service-update') {
    // serviceInstanceUpdate for start command etc
    const serviceId = process.argv[3];
    const environmentId = process.argv[4];
    const startCommand = process.argv[5];
    const d = await gql(
      `mutation($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) {
        serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input) {
          id
        }
      }`,
      {
        environmentId,
        serviceId,
        input: {
          startCommand,
          buildCommand: 'npm install && npm install -g @okxweb3/a2a-node@latest || true',
          rootDirectory: null
        }
      }
    );
    console.log(JSON.stringify(d.serviceInstanceUpdate, null, 2));
    return;
  }

  if (cmd === 'var-upsert') {
    const projectId = process.argv[3];
    const environmentId = process.argv[4];
    const serviceId = process.argv[5];
    const name = process.argv[6];
    const value = process.argv[7];
    const d = await gql(
      `mutation($input: VariableUpsertInput!) {
        variableUpsert(input: $input)
      }`,
      {
        input: {
          projectId,
          environmentId,
          serviceId,
          name,
          value
        }
      }
    );
    console.log(JSON.stringify(d, null, 2));
    return;
  }

  if (cmd === 'deploy') {
    const serviceId = process.argv[3];
    const environmentId = process.argv[4];
    let d;
    try {
      d = await gql(
        `mutation($serviceId: String!, $environmentId: String!) {
          serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
        }`,
        { serviceId, environmentId }
      );
    } catch (e) {
      console.error('deployV2 failed:', e.message);
      d = await gql(
        `mutation($serviceId: String!, $environmentId: String!) {
          serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
        }`,
        { serviceId, environmentId }
      );
    }
    console.log(JSON.stringify(d, null, 2));
    return;
  }

  if (cmd === 'volume-create') {
    const projectId = process.argv[3];
    const environmentId = process.argv[4];
    const serviceId = process.argv[5];
    const mountPath = process.argv[6] || '/data';
    const d = await gql(
      `mutation($input: VolumeCreateInput!) {
        volumeCreate(input: $input) {
          id
          name
        }
      }`,
      {
        input: {
          projectId,
          environmentId,
          serviceId,
          mountPath,
          name: 'okx-agent-data'
        }
      }
    );
    console.log(JSON.stringify(d.volumeCreate, null, 2));
    return;
  }

  console.error('Unknown command:', cmd);
  process.exit(1);
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  if (e.details) console.error(JSON.stringify(e.details, null, 2));
  process.exit(1);
});
