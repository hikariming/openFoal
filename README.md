# OpenFoal

基于 `pi` 二次开发的个人/企业通用 Agent 平台。

OpenFoal 的核心策略不是重写 Agent Runtime，而是复用 `pi` 的成熟能力，重点建设 Gateway、多渠道接入、多租户治理和企业级安全。

## 1. 项目定位

- 技术定位：`pi-core + OpenFoal-gateway + OpenFoal-enterprise`
- 产品定位：一套核心，支持两种部署形态
- 目标用户：
  - 个人开发者/创作者（本地桌面优先）
  - 企业团队（云端托管、多租户、审计可控）

## 2. 设计基线

OpenFoal 以 `pi` 作为核心引擎：

- `@mariozechner/pi-ai`：多模型 Provider 抽象
- `@mariozechner/pi-agent-core`：Agent Runtime + Tool Loop
- `skills` 机制：按需加载、低耦合扩展

OpenFoal 在此基础上新增：

- Gateway 控制平面（Auth / Routing / Session / Policy）
- 多渠道接入（Slack/Telegram/Discord/WhatsApp/Web/Desktop）
- 多租户与企业治理（RBAC、审计、预算与策略）
- Personal 前端共享内核（`packages/personal-app`）+ 双壳（Web/Desktop）

## 3. 架构总览

```text
Access Layer
  Telegram | WhatsApp | Discord | Slack | Web | Tauri Desktop

Gateway Layer
  AuthN/AuthZ | Session Router | Policy Engine | Rate Limit | Event Bus

Core Layer (pi-based)
  Agent Runtime | Skill Engine | Context Transform | Tool Orchestrator

Execution Layer
  Bash | File | Browser | API | Custom Skills

Storage Layer
  SQLite/Postgres | Local Files | S3/MinIO(optional) | Vector(optional)

Model Layer
  OpenAI | Anthropic | Google | DeepSeek | OpenAI-compatible
```

## 4. 个人版 vs 企业版

| 维度 | 个人版（Desktop-First） | 企业版（Cloud-Managed） |
|---|---|---|
| 部署 | 本机单机 | 云端集群 |
| 租户模型 | 单租户 | 多租户 |
| 入口 | Tauri + Web | IM + Web Console + API |
| 数据 | SQLite + 本地文件 | Postgres + 对象存储 |
| 权限 | 本地账户/API Key | SSO + RBAC + 审计 |
| 执行隔离 | 本地容器/沙箱 | 租户级沙箱池 |

## 4.1 LLM 配置（参考 OpenClaw 风格）

后端支持统一 JSON 配置 + 环境变量注入：

- 默认配置路径：`~/.openfoal/openfoal.json`
- 覆盖路径：`OPENFOAL_CONFIG_PATH=/path/to/openfoal.json`
- 企业策略覆盖：`OPENFOAL_POLICY_PATH=/path/to/policy.json`

`modelRef/provider/model` 解析优先级：

1. 代码显式传入（`pi.modelRef` > `pi.provider`/`pi.modelId`）
2. 配置文件（`llm.defaultModelRef` > `llm.defaultProvider`/`llm.defaultModel`，含 policy merge）
3. 环境变量 fallback（`OPENFOAL_PI_MODEL_REF` > `OPENFOAL_PI_PROVIDER`/`OPENFOAL_PI_MODEL`）

示例（Kimi，openai-compatible）：

```json
{
  "version": 1,
  "llm": {
    "defaultModelRef": "kimi-default",
    "models": {
      "kimi-default": {
        "provider": "kimi",
        "modelId": "k2p5",
        "baseUrl": "https://api.moonshot.cn/v1",
        "apiKey": "${KIMI_API_KEY}"
      },
      "openai-fast": {
        "provider": "openai",
        "modelId": "gpt-4o-mini"
      }
    },
    "providers": {
      "kimi": {
        "api": "openai-completions"
      },
      "openai": {
        "api": "openai-completions"
      }
    }
  }
}
```

## 5. 目录规划

```text
openFoal/
  README.md
  DESIGN.md
  apps/
    gateway/               # Gateway service
    desktop/               # Tauri app
    web-console/           # Enterprise control panel
  packages/
    protocol/              # Event/request/response schema
    core/                  # pi runtime wrapper
    gateway-core/          # auth/routing/session/policy
    channel-connectors/    # slack/telegram/discord/...
    tool-executor/         # tools + sandbox + controls
    skill-engine/          # skill discovery/validation/load
    model-adapters/        # provider policy + fallback strategy
    storage/               # repositories + migrations
```

## 6. 开发路线（建议）

### Phase 1: 可运行 MVP

1. 封装 `pi` runtime（单模型 + 基础工具）
2. 实现 Gateway 最小闭环（connect/auth/route/session）
3. 打通 1 个渠道（建议 Slack）
4. 打通 Desktop（Tauri）
5. 建立最小审计与安全策略（allowlist/pairing）

### Phase 2: 个人版可用

1. Skills 管理（安装、加载、版本）
2. 记忆压缩与检索
3. 本地沙箱执行策略

### Phase 3: 企业版可商用

1. 多租户 + RBAC
2. 模型/工具/预算策略中心
3. 网关与执行层横向扩展
4. 企业审计导出

## 7. 引入 OpenClaw 记忆设计（已纳入方案）

OpenFoal 将吸收 `openclaw-main` 已验证的记忆/会话管理机制：

1. 双层持久化：`sessions index` + `session transcript(jsonl)`，索引与记录分离。
2. 会话键规范化：主会话、私聊、群组、线程采用统一 key 规则，支持 `dmScope`。
3. 压缩与修剪分离：`compaction` 持久化摘要，`pruning` 仅请求内临时瘦身。
4. 压缩前静默记忆刷新：会话接近压缩阈值时，触发一次 `NO_REPLY` 记忆写入回合。
5. Markdown 记忆分层：`MEMORY.md`（长期）+ `memory/YYYY-MM-DD.md`（日记）。
6. 记忆检索增强：向量检索 + BM25 混合检索 + 嵌入缓存（避免重复索引成本）。

## 8. 关键非目标（当前阶段）

- 不从零重写 LLM/Agent Core
- 不在早期做“全渠道一次性接入”
- 不在 MVP 阶段追求复杂工作流编排系统

## 9. 技术选型建议

- Runtime: Node.js + TypeScript
- Gateway: WS + HTTP（同进程或拆分）
- Desktop: Tauri
- DB: SQLite（个人）/ Postgres（企业）
- Object Storage: S3/MinIO（可选）
- Queue（企业规模后）：Redis/NATS（二选一）

## 10. 下一步

- 详细架构和接口契约见：`/Users/rqq/openFoal/DESIGN.md`

## 11. Docker 快速启动

一键启动（个人版）：

```bash
cd /Users/rqq/openFoal
npm run up:personal
```

访问：`http://127.0.0.1:5180`

说明：

1. 个人版已移除 `mock` 回复模式，网关只走真实模型推理链路。
2. 未配置可用 API Key 时，`agent.run` 会返回 `MODEL_UNAVAILABLE`（不会再进入 mock 回答）。

一键启动（企业版）：

```bash
cd /Users/rqq/openFoal
npm run up:enterprise
```

企业版默认鉴权：

1. `OPENFOAL_AUTH_MODE=hybrid`
2. `OPENFOAL_ENTERPRISE_REQUIRE_AUTH=true`
3. 默认管理员：`tenant=default` / `username=admin` / `password=admin123!`

访问：

1. 企业控制台：`http://127.0.0.1:5173`
2. 网关健康：`http://127.0.0.1:8787/health`

常用运维命令：

```bash
npm run logs:personal
npm run logs:enterprise
npm run ps:docker
npm run down:personal
npm run down:enterprise
```

## 12. 文档入口（当前有效）

当前仅以下文档用于产品规划与实施：

1. [Product Truth（唯一真相）](./docs/PRODUCT_TRUTH.md)
2. [Archived Docs（归档索引）](./docs/ARCHIVED_DOCS.md)
3. [Test Case Index](./docs/testing/TEST_CASE_INDEX.md)
4. [P1 Personal Access Test Plan](./docs/testing/P1_PERSONAL_ACCESS_TEST_PLAN.md)
5. [P2 Enterprise Control Test Plan](./docs/testing/P2_ENTERPRISE_CONTROL_TEST_PLAN.md)
6. [P2 Docker Runner HTTP Protocol](./docs/testing/P2_DOCKER_RUNNER_HTTP_PROTOCOL.md)
7. [Auth & Tenant Test Plan](./docs/testing/AUTH_TENANT_TEST_PLAN.md)
8. [Deploy & Usage Manual](./docs/DEPLOY_AND_USAGE_MANUAL.md)

## 13. P2 联调脚本

一键启动 `mock docker-runner + gateway + web-console`，并验证审计筛选/分页链路：

1. `npm run test:p2:e2e`
2. Docker 栈已启动时验证：`npm run test:p2:e2e:docker`
