# Always-on OKX A2A worker for Shiori (marketplace online + heartbeats)
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl bash \
  && rm -rf /var/lib/apt/lists/*

# OnchainOS CLI (needed by okx-a2a for heartbeat + xmtp-sign)
RUN curl -sSL https://raw.githubusercontent.com/okx/onchainos-skills/main/install.sh | sh \
  && ln -sf /root/.local/bin/onchainos /usr/local/bin/onchainos \
  && onchainos --version || true

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev \
  && npm install @okxweb3/a2a-node@latest --no-save \
  && ln -sf /app/node_modules/@okxweb3/a2a-node/dist/cli.js /usr/local/bin/okx-a2a-cli.js \
  && printf '%s\n' '#!/usr/bin/env bash' 'exec node /usr/local/bin/okx-a2a-cli.js "$@"' > /usr/local/bin/okx-a2a \
  && chmod +x /usr/local/bin/okx-a2a

COPY . .

# Fake Claude CLI → Shiori HTTP brain
RUN chmod +x /app/scripts/bin/claude \
  && ln -sf /app/scripts/bin/claude /usr/local/bin/claude \
  && chmod +x /app/scripts/railway-a2a-worker.js /app/scripts/bootstrap-identity.js || true

ENV NODE_ENV=production \
    OKX_A2A_ENABLE=1 \
    OKX_AGENT_TASK_HOME=/data/okx-agent-task \
    HOME=/data \
    DATA_DIR=/data \
    PATH="/usr/local/bin:/root/.local/bin:/app/scripts/bin:${PATH}" \
    OKX_A2A_AI_PROVIDER=claude \
    OKX_A2A_AI_CLAUDE_COMMAND=/app/scripts/bin/claude

EXPOSE 8080
CMD ["node", "scripts/railway-start.js"]
