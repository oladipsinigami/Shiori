/**
 * HTTP A2A / A2MCP surface for Shiori.
 *
 * OKX.AI native A2A uses XMTP via the okx-a2a daemon (see scripts/shiori-claude-shim.js).
 * This module exposes the same brain over HTTP so:
 *  - marketplace HTTP / A2MCP-style clients can hire Shiori
 *  - Google-style A2A clients can discover the agent card and send messages
 *  - the public preview chat and demos share one code path
 */

const { randomUUID } = require('crypto');
const { runObito } = require('./obito-core');

const tasks = new Map();
const MAX_TASKS = 500;

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : null) ||
  process.env.RENDER_EXTERNAL_URL ||
  'https://shiori-a2a-worker-production.up.railway.app';

function agentCard() {
  return {
    name: 'Shiori',
    description:
      'Shiori provides 1-3 personalized movie, anime, and novel recommendations with clear human-like reasoning, taste memory, and schedule awareness. Ask Shiori for recommendations across any genre or media type.',
    url: PUBLIC_BASE_URL.replace(/\/$/, ''),
    provider: {
      organization: 'Shiori (OKX.AI ASP #5001)',
      url: 'https://www.okx.com'
    },
    version: '0.1.0',
    protocolVersion: '0.2.9',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false
    },
    defaultInputModes: ['text', 'text/plain'],
    defaultOutputModes: ['text', 'text/plain'],
    skills: [
      {
        id: 'media-recommendations',
        name: 'Media Recommendations',
        description:
          'Personalized movie, anime, and novel recommendations with human-like reasoning, taste memory, and time-awareness.',
        tags: ['recommendations', 'movies', 'anime', 'novels', 'media', 'librarian'],
        examples: [
          'I like cozy anime and slow-burn novels. I have 90 minutes tonight.',
          'Recommend something light after a long work day — not too dark.',
          'I loved Your Name and Before Sunrise. What should I watch next?'
        ],
        inputModes: ['text'],
        outputModes: ['text']
      }
    ],
    // OKX.AI publication metadata (informational)
    okx: {
      agentName: 'Shiori',
      agentId: process.env.OKX_AGENT_ID || '5001',
      role: 'ASP',
      service: 'Media Recommendations',
      pricing: '0.01 USDT',
      wallet: process.env.OKX_WALLET_ADDRESS || '0xa2fbc18fd6306d84566f85edd6912fc8f91af33c',
      modes: ['A2A', 'A2MCP-HTTP']
    }
  };
}

function extractTextFromMessage(message) {
  if (!message) return '';
  if (typeof message === 'string') return message.trim();
  if (typeof message.text === 'string') return message.text.trim();
  if (typeof message.content === 'string') return message.content.trim();
  if (typeof message.prompt === 'string') return message.prompt.trim();
  if (typeof message.query === 'string') return message.query.trim();
  if (typeof message.request === 'string') return message.request.trim();
  if (typeof message.input === 'string') return message.input.trim();
  if (typeof message.user_input === 'string') return message.user_input.trim();
  if (typeof message.topic === 'string') return message.topic.trim();
  if (Array.isArray(message.messages)) {
    return extractTextFromMessage(message.messages);
  }
  if (Array.isArray(message.parts)) {
    return message.parts
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p.text === 'string') return p.text;
        if (p && typeof p.content === 'string') return p.content;
        if (p && p.type === 'text' && typeof p.text === 'string') return p.text;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (Array.isArray(message)) {
    return message
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p.text === 'string') return p.text;
        if (p && typeof p.content === 'string') return p.content;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (typeof message === 'object') {
    for (const key of ['message', 'prompt', 'query', 'request', 'text', 'input', 'user_input', 'topic', 'arguments', 'params']) {
      if (typeof message[key] === 'string' && message[key].trim()) {
        return message[key].trim();
      }
      if (message[key] && typeof message[key] === 'object') {
        const nested = extractTextFromMessage(message[key]);
        if (nested) return nested;
      }
    }
  }
  return '';
}

function resolveUserId(body = {}, message = {}) {
  return (
    body.userId ||
    body.user_id ||
    body.sessionId ||
    body.session_id ||
    message.contextId ||
    message.context_id ||
    body.contextId ||
    body.metadata?.userId ||
    `a2a-${randomUUID().slice(0, 8)}`
  );
}

function rememberTask(task) {
  tasks.set(task.id, task);
  if (tasks.size > MAX_TASKS) {
    const oldest = tasks.keys().next().value;
    tasks.delete(oldest);
  }
}

function taskToJson(task) {
  return {
    id: task.id,
    contextId: task.contextId,
    status: {
      state: task.state,
      message: task.statusMessage
        ? {
            role: 'agent',
            parts: [{ type: 'text', text: task.statusMessage }]
          }
        : undefined,
      timestamp: task.updatedAt
    },
    artifacts: task.artifacts || [],
    history: task.history || [],
    metadata: task.metadata || {},
    kind: 'task'
  };
}

async function runTask({ userId, text, metadata = {} }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const task = {
    id,
    contextId: userId,
    state: 'working',
    statusMessage: null,
    artifacts: [],
    history: [
      {
        role: 'user',
        parts: [{ type: 'text', text }],
        messageId: randomUUID()
      }
    ],
    metadata: { ...metadata, userId, source: metadata.source || 'a2a' },
    createdAt: now,
    updatedAt: now
  };
  rememberTask(task);

  try {
    const { text: reply, recIds } = await runObito(userId, text);
    task.state = 'completed';
    task.statusMessage = reply;
    task.artifacts = [
      {
        artifactId: randomUUID(),
        name: 'recommendation',
        parts: [{ type: 'text', text: reply }],
        metadata: { recIds }
      }
    ];
    task.history.push({
      role: 'agent',
      parts: [{ type: 'text', text: reply }],
      messageId: randomUUID()
    });
    task.metadata.recIds = recIds;
    task.updatedAt = new Date().toISOString();
    rememberTask(task);
    return task;
  } catch (err) {
    task.state = 'failed';
    task.statusMessage = err.message || 'Task failed';
    task.updatedAt = new Date().toISOString();
    rememberTask(task);
    throw err;
  }
}

async function handleJsonRpc(body) {
  const id = body?.id ?? null;
  const method = body?.method;
  const params = body?.params || {};

  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({
    jsonrpc: '2.0',
    id,
    error: { code, message }
  });

  try {
    if (
      method === 'agent/getAuthenticatedExtendedCard' ||
      method === 'agent/card' ||
      method === 'agent/get' ||
      method === 'agent/info' ||
      method === 'agentCard'
    ) {
      return ok(agentCard());
    }

    if (method === 'message/send' || method === 'tasks/send') {
      const message = params.message || params;
      const text = extractTextFromMessage(message) || 'Please recommend 1-3 top movie, anime, or novel recommendations for me.';
      const userId = resolveUserId(params, message);
      const task = await runTask({
        userId,
        text,
        metadata: { source: 'a2a-jsonrpc', method }
      });
      return ok(taskToJson(task));
    }

    if (method === 'tasks/get') {
      const taskId = params.id || params.taskId;
      const task = tasks.get(taskId);
      if (!task) return fail(-32001, `Task not found: ${taskId}`);
      return ok(taskToJson(task));
    }

    if (method === 'tasks/cancel') {
      const taskId = params.id || params.taskId;
      const task = tasks.get(taskId);
      if (!task) return fail(-32001, `Task not found: ${taskId}`);
      if (task.state === 'working') {
        task.state = 'canceled';
        task.updatedAt = new Date().toISOString();
      }
      return ok(taskToJson(task));
    }

    return fail(-32601, `Method not found: ${method}`);
  } catch (err) {
    return fail(-32000, err.message || 'Internal error');
  }
}

/**
 * REST helper used by /a2a/tasks and /a2mcp/*
 */
async function handleRestTask(body = {}) {
  let text =
    extractTextFromMessage(body.message) ||
    extractTextFromMessage(body.arguments) ||
    extractTextFromMessage(body.params) ||
    extractTextFromMessage(body.input) ||
    extractTextFromMessage(body);

  if (!text) {
    text = 'Please recommend 1-3 top movie, anime, or novel recommendations for me.';
  }

  const userId = resolveUserId(body, body.message || {});
  const task = await runTask({
    userId,
    text,
    metadata: { source: body.source || 'a2a-rest' }
  });
  return {
    taskId: task.id,
    userId,
    status: task.state,
    response: task.statusMessage,
    recIds: task.metadata.recIds || [],
    task: taskToJson(task)
  };
}

function a2mcpTools() {
  return {
    tools: [
      {
        name: 'media_recommendations',
        description:
          'Get 1-3 personalized movie, anime, or novel recommendations immediately with human-like reasoning.',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description:
                'Natural language request including favorites, mood, or schedule.'
            },
            userId: {
              type: 'string',
              description: 'Stable user id for taste memory across turns.'
            }
          },
          required: []
        }
      }
    ]
  };
}

async function handleA2mcpInvoke(body = {}) {
  const tool = body.tool || body.name || body.method || 'media_recommendations';
  const args = body.arguments || body.params || body.input || body;
  const msgText =
    extractTextFromMessage(args) ||
    extractTextFromMessage(body) ||
    'Please recommend 1-3 top movie, anime, or novel recommendations for me.';

  const result = await handleRestTask({
    message: msgText,
    userId: args.userId || body.userId || body.user_id,
    source: 'a2mcp'
  });
  return {
    content: [{ type: 'text', text: result.response }],
    isError: false
  };
}

module.exports = {
  agentCard,
  handleJsonRpc,
  handleRestTask,
  handleA2mcpInvoke,
  extractTextFromMessage,
  a2mcpTools,
  getTask: (id) => tasks.get(id),
  PUBLIC_BASE_URL
};
