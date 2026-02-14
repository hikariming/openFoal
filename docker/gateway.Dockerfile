FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends sqlite3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@9.15.4 typescript@5.6.3

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/gateway ./apps/gateway
COPY packages ./packages
COPY scripts ./scripts

RUN pnpm install --no-frozen-lockfile
RUN node scripts/backend-build.mjs

ENV OPENFOAL_GATEWAY_HOST=0.0.0.0
ENV OPENFOAL_GATEWAY_PORT=8787
ENV OPENFOAL_GATEWAY_SQLITE_PATH=/data/gateway.sqlite

EXPOSE 8787

CMD ["node", "scripts/gateway-dev.mjs"]
