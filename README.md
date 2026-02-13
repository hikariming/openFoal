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
    tool-executor/         # tools + sandbox + approvals
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

## 11. v1 文档入口

为便于直接开工，v1 规划已沉淀在 `docs/`：

1. [Backend 架构（v1）](./docs/BACKEND_ARCHITECTURE_V1.md)
2. [Agent 设计（v1）](./docs/AGENT_DESIGN_V1.md)
3. [API 契约（v1）](./docs/API_CONTRACT_V1.md)
4. [实施路线图（v1）](./docs/IMPLEMENTATION_ROADMAP_V1.md)
5. [UI 到 API 映射（v1）](./docs/UI_API_MAPPING_V1.md)
6. [多租户设计（演进版）](./docs/MULTI_TENANCY_DESIGN.md)
7. [实施路径（执行版）](./docs/IMPLEMENTATION_EXECUTION_PATH_V1.md)
8. [后端测试策略（v1）](./docs/BACKEND_TEST_STRATEGY_V1.md)
