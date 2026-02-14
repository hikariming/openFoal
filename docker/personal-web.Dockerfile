FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN npm install -g pnpm@9.15.4

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/personal-web ./apps/personal-web
COPY packages ./packages

RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @openfoal/personal-web build

FROM nginx:1.27-alpine

COPY --from=build /app/apps/personal-web/dist /usr/share/nginx/html

ENV OPENFOAL_GATEWAY_BASE_URL=http://localhost:8787

EXPOSE 80

CMD ["sh", "-c", "printf 'window.__OPENFOAL_CONFIG__={gatewayBaseUrl:\"%s\"};\\n' \"$OPENFOAL_GATEWAY_BASE_URL\" > /usr/share/nginx/html/openfoal-config.js && exec nginx -g 'daemon off;'"]
