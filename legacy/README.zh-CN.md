# OpenFoal（中文）

[English Version](./README.en.md)


### OpenFoal 是什么

OpenFoal 是一个基于 `pi` 二次开发的 Agent 平台，核心目标是解决一个现实问题：
很多 AI 助手项目在“个人可用”和“企业可控”之间断层明显，导致从原型到生产需要重写架构。

OpenFoal 的选择是:

1. 复用成熟 Agent Runtime，不重复造轮子。
2. 把工程能力投入到 Gateway、治理、安全、部署和多端接入。
3. 用同一套核心能力同时服务个人版和企业版。

### 项目价值

1. 降低从个人原型到团队上线的迁移成本。
2. 让“好用”与“可控”不再是二选一。
3. 在保证扩展性的同时，保持最小可运行复杂度。

### 当前真实状态（以代码和 `docs/PRODUCT_TRUTH.md` 为准）

更新时间参考：`2026-02-14`

已实现能力：

1. Gateway 主链路：`connect`、`agent.run`、`agent.abort`、`sessions.*`、`policy.*`、`audit.query`、`metrics.summary`、`memory.*`。
2. 个人产品基线：
   - `apps/desktop`（Tauri）
   - `apps/personal-web`（浏览器入口）
   - 共享 UI 核心 `packages/personal-app`（一套前端，两层壳）
3. 企业最小治理闭环：
   - `apps/web-console`
   - 多租户 scope 注入
   - 三角色 RBAC（`tenant_admin` / `workspace_admin` / `member`）
   - 预算、策略、审计、执行目标管理
4. 执行与存储：
   - 工具执行：`bash.exec`、`file.*`、`http.request`、`memory.*` 等
   - 存储后端：个人 `SQLite`，企业 `Postgres + Redis + MinIO`（Docker 组合）
5. 部署与验证：
   - 一键 Docker 启动个人版/企业版/双栈
   - `test:backend`、`test:auth`、`test:p1:smoke`、`test:p2:e2e`、`smoke:enterprise:full`

当前边界（未完成或仅占位）：

1. `runtimeMode=cloud` 语义已存在，但尚未形成独立云执行闭环。
2. 企业完整 SSO 门户、复杂权限树和组织架构能力仍在后续阶段。
3. `docker-runner` 目前为最小 HTTP 协议实现，生产级 mTLS/证书轮换等能力未完整落地。

### 为什么它值得投入

1. 对个人开发者：快速得到可运行、可扩展、可迁移的本地 AI 工作台。
2. 对技术团队：在同一代码基座上获得审计、预算、权限、策略和多租户能力。
3. 对产品路线：避免“先做 Demo，再重构成企业版”的重复投入。

### 架构概览

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

### 个人版与企业版

| 维度 | Personal Runtime | Enterprise Control |
|---|---|---|
| 用户模型 | 单用户 | 多租户/多工作区 |
| 入口 | Desktop + Personal Web | Web Console + API |
| 数据后端 | SQLite + 本地文件 | Postgres + Redis + MinIO |
| 治理能力 | 轻量 | RBAC + 审计 + 预算 + 策略 |
| 典型目标 | 个人效率与创作 | 团队协作与可控上线 |

### 快速开始

前置：

1. Node.js + npm/pnpm
2. Docker + Docker Compose

个人版：

```bash
cd /Users/rqq/openFoal
npm run up:personal
```

访问：

1. `http://127.0.0.1:5180`（Personal Web）
2. `http://127.0.0.1:8787/health`（Gateway 健康）

企业版（包含启动后验活）：

```bash
cd /Users/rqq/openFoal
npm run up:enterprise:all
```

默认管理员：

1. `tenant=default`
2. `username=admin`
3. `password=admin123!`

访问：

1. `http://127.0.0.1:5200`（Web Console）
2. `http://127.0.0.1:8787/health`（Gateway 健康）

停止：

```bash
npm run down:personal
npm run down:enterprise
```

### 开发与测试命令

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

### 仓库结构

```text
apps/
  gateway/       # API gateway and runtime orchestration
  personal-web/  # browser entry for personal users
  desktop/       # tauri desktop shell
  web-console/   # enterprise admin console

packages/
  core/          # pi runtime integration
  protocol/      # rpc/event contracts
  storage/       # sqlite/postgres/redis/minio adapters
  tool-executor/ # tool runtime and guards
  personal-app/  # shared personal UI core
  skill-engine/  # skill discovery/loading
```

### 文档入口

1. [Product Truth（唯一真相）](./docs/PRODUCT_TRUTH.md)
2. [Deploy & Usage Manual](./docs/DEPLOY_AND_USAGE_MANUAL.md)
3. [Test Case Index](./docs/testing/TEST_CASE_INDEX.md)
4. [Archived Docs（历史归档）](./docs/ARCHIVED_DOCS.md)

