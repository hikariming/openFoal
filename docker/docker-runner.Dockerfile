FROM node:22-bookworm-slim

WORKDIR /app

RUN npm install -g pnpm@9.15.4 typescript@5.6.3

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/gateway ./apps/gateway
COPY packages ./packages
COPY scripts ./scripts

RUN pnpm install --no-frozen-lockfile
RUN node scripts/backend-build.mjs

ENV RUNNER_HOST=0.0.0.0
ENV RUNNER_PORT=8081
ENV RUNNER_AUTH_TOKEN=runner-demo-token
ENV RUNNER_WORKSPACE_ROOT=/workspace
ENV RUNNER_DEFAULT_TIMEOUT_MS=15000

VOLUME ["/workspace"]

EXPOSE 8081

CMD ["node", "scripts/docker-runner-server.mjs"]
