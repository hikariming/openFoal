# OpenFoal (English)

[中文版本](./README.zh-CN.md)


### What OpenFoal Is

OpenFoal is an agent platform built on top of `pi`, designed to close a common gap:
projects that are great for solo use often break down when teams need governance, security, and operational control.

OpenFoal's strategy:

1. Reuse a proven agent runtime instead of rebuilding it.
2. Invest engineering effort in gateway control plane, governance, safety, and deployment.
3. Keep personal and enterprise experiences on one shared core.

### Why It Matters

1. It reduces migration cost from personal prototype to team production.
2. It combines usability and controllability without forcing a platform rewrite.
3. It keeps architecture extensible while staying pragmatic for real delivery timelines.

### Current Product Truth (from code + `docs/PRODUCT_TRUTH.md`)

Reference update: `2026-02-14`

Implemented today:

1. Gateway flow: `connect`, `agent.run`, `agent.abort`, `sessions.*`, `policy.*`, `audit.query`, `metrics.summary`, `memory.*`.
2. Personal baseline:
   - `apps/desktop` (Tauri)
   - `apps/personal-web` (browser access)
   - Shared frontend core in `packages/personal-app`
3. Enterprise baseline:
   - `apps/web-console`
   - Tenant/workspace scope injection
   - 3-role RBAC (`tenant_admin`, `workspace_admin`, `member`)
   - Budget, policy, audit, and execution-target management
4. Execution and storage:
   - Tools such as `bash.exec`, `file.*`, `http.request`, `memory.*`
   - `SQLite` for personal mode, `Postgres + Redis + MinIO` for enterprise Docker mode
5. Dev and QA workflows:
   - One-command Docker startup for personal, enterprise, or dual stack
   - Backend/auth/smoke/e2e test scripts included

Known boundaries:

1. `runtimeMode=cloud` exists as a semantic mode but not yet a full standalone cloud execution loop.
2. Full enterprise SSO portal and advanced org/permission tree are not fully delivered yet.
3. `docker-runner` is currently an HTTP baseline, not yet full production hardening (mTLS, cert rotation, etc.).

### Value by Audience

1. Solo builders: local-first AI runtime with a clear upgrade path.
2. Engineering teams: policy, audit, budget, and RBAC on the same codebase.
3. Product owners: avoid rebuilding from demo architecture to enterprise architecture.

### Architecture

```text
Access Layer
  Web | Tauri Desktop | Enterprise Web Console | (Extensible IM channels)

Gateway Layer
  Auth/AuthZ | Session Router | Policy Guard | Audit | Metrics

Core Layer (pi-based)
  Agent Runtime | Skill Engine | Tool Orchestration

Execution Layer
  Local tools | Remote docker-runner (HTTP baseline)

Storage Layer
  SQLite (personal) | Postgres + Redis + MinIO (enterprise)
```

### Personal vs Enterprise

| Dimension | Personal Runtime | Enterprise Control |
|---|---|---|
| User model | Single user | Multi-tenant / multi-workspace |
| Entry points | Desktop + Personal Web | Web Console + API |
| Storage | SQLite + local files | Postgres + Redis + MinIO |
| Governance | Lightweight | RBAC + audit + budget + policy |
| Goal | Personal productivity | Controlled team operations |

### Quick Start

Prerequisites:

1. Node.js + npm/pnpm
2. Docker + Docker Compose

Personal stack:

```bash
cd /Users/rqq/openFoal
npm run up:personal
```

Open:

1. `http://127.0.0.1:5180` (Personal Web)
2. `http://127.0.0.1:8787/health` (Gateway health)

Enterprise stack (startup + smoke verification):

```bash
cd /Users/rqq/openFoal
npm run up:enterprise:all
```

Default admin credentials:

1. `tenant=default`
2. `username=admin`
3. `password=admin123!`

Open:

1. `http://127.0.0.1:5200` (Web Console)
2. `http://127.0.0.1:8787/health` (Gateway health)

Stop:

```bash
npm run down:personal
npm run down:enterprise
```

### Developer Commands

```bash
# development
npm run dev:gateway
pnpm --filter @openfoal/personal-web dev
pnpm --filter @openfoal/web-console dev

# verification
npm run test:backend
npm run test:auth
npm run test:p1:smoke
npm run test:p2:e2e
npm run test:p2:e2e:docker
npm run smoke:enterprise:full
```

### Repository Layout

```text
apps/
  gateway/
  personal-web/
  desktop/
  web-console/

packages/
  core/
  protocol/
  storage/
  tool-executor/
  personal-app/
  skill-engine/
```

### Documents

1. [Product Truth](./docs/PRODUCT_TRUTH.md)
2. [Deploy & Usage Manual](./docs/DEPLOY_AND_USAGE_MANUAL.md)
3. [Test Case Index](./docs/testing/TEST_CASE_INDEX.md)
4. [Archived Docs](./docs/ARCHIVED_DOCS.md)
