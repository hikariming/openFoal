FROM node:22-bookworm-slim

WORKDIR /app

RUN npm install -g pnpm@9.15.4 typescript@5.6.3

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/gateway ./apps/gateway
COPY packages ./packages
COPY scripts ./scripts

RUN pnpm install --no-frozen-lockfile
RUN node scripts/backend-build.mjs

ENV ORCHESTRATOR_HOST=0.0.0.0
ENV ORCHESTRATOR_PORT=8081
ENV ORCHESTRATOR_AUTH_TOKEN=runner-demo-token
ENV ORCHESTRATOR_WORKSPACE_ROOT=/workspace
ENV ORCHESTRATOR_DEFAULT_TIMEOUT_MS=15000
ENV ORCHESTRATOR_IDLE_TTL_SEC=900
ENV ORCHESTRATOR_MAX_TTL_SEC=7200
ENV ORCHESTRATOR_BLOB_BACKEND=fs
ENV ORCHESTRATOR_REDIS_URL=
ENV ORCHESTRATOR_MINIO_ENDPOINT=http://minio:9000
ENV ORCHESTRATOR_MINIO_REGION=us-east-1
ENV ORCHESTRATOR_MINIO_ACCESS_KEY=openfoal
ENV ORCHESTRATOR_MINIO_SECRET_KEY=openfoal123
ENV ORCHESTRATOR_MINIO_BUCKET=openfoal-enterprise

VOLUME ["/workspace"]

EXPOSE 8081

CMD ["node", "scripts/sandbox-orchestrator-server.mjs"]
