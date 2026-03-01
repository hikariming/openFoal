# OpenFoal Backend Skeleton

NestJS + Fastify + Prisma skeleton for enterprise agent backend.

## Quick Start

1. Install dependencies

```bash
npm install
```

2. Create the new database (recommended name: `aidb5_agent`) on your PostgreSQL server.

3. Generate Prisma client

```bash
npm run prisma:generate
```

4. Run migrations (dev)

```bash
npm run prisma:migrate:dev -- --name init
```

5. Start backend

```bash
npm run dev
```

API prefix is `/api`.

`GET /api/health` now checks connectivity for:
- PostgreSQL (via Prisma)
- Redis
- MinIO bucket availability

## Initial Endpoints

- `GET /api/health`
- `POST /api/auth/token`
- `GET /api/tenants`
- `GET /api/sandboxes`
- `GET /api/agents`
- `GET /api/audit-logs`

## Test Scripts

```bash
npm run test
npm run test:unit
npm run test:e2e
npm run test:coverage
```
