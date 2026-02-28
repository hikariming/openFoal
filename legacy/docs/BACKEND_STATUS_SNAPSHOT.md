> [!WARNING]
> ARCHIVED (2026-02-14): This document is kept for historical reference only.
> Active source of truth: `/Users/rqq/openFoal/docs/PRODUCT_TRUTH.md`.
> Do not use this file for planning or implementation.

# 后端现状快照（Local-First）

更新时间：2026-02-13

## 已落地（真实实现）

1. `packages/protocol`
- 已定义并校验 `connect/agent.run/agent.abort/runtime.setMode/sessions.create|list|get|history/policy.get|update/（已移除）|resolve/audit.query/metrics.summary`。
- side-effect 方法强制 `idempotencyKey`。
- 错误码包含 `POLICY_DENIED`、`POLICY_DENIED` 等治理语义。

2. `apps/gateway`
- 已提供 HTTP(`/health`, `/rpc`) + WS(`/ws`) 网关服务。
- 已实现连接态、事件序号、会话运行锁、模式切换排队。
- 已实现 side-effect 幂等缓存与参数冲突检测。
- `sessions.get` 已返回 `contextUsage/compactionCount/memoryFlushState(/memoryFlushAt)`。
- `policy.get/update` 已接 SQLite/InMemory repository，返回结构化 policy（含 `version/updatedAt`）。
- `（已移除）/resolve` 已接 SQLite/InMemory repository，返回真实策略门禁对象。
- `metrics.summary` 已接真实聚合（`runsTotal/runsFailed/toolCallsTotal/toolFailures/p95LatencyMs`）。
- `agent.run` 已记录 transcript、run metrics，并在高风险工具上执行 policy gate（allow/deny/allow）。

3. `packages/storage`
- 已实现 SQLite + InMemory 仓储：
  - Session（含元数据扩展与迁移补列）
  - Transcript
  - Idempotency
  - Policy
  - Approval
  - Metrics
- 已支持重启后恢复 policy/policy-gate/session 元数据。

4. `packages/tool-executor`
- 已实现 local driver：`bash.exec`、`file.read/write/list`、`http.request`、`math.add`、`text.upper`、`echo`。
- 已实现记忆工具：`memory.get`、`memory.appendDaily`（local only）。
- `memory.get` 已做白名单路径限制：仅 `MEMORY.md` 与 `memory/*.md`。

5. `packages/core`
- 已接入 legacy + pi runtime。
- 已注册 memory 工具到 public tool 集合。
- 已支持引导文件最小集注入（`AGENTS.md/SOUL.md/TOOLS.md/USER.md`）：
  - 缺失创建
  - 不覆盖已有
  - 注入长度上限

## 当前轮次边界（明确不做）

1. Cloud runtime（Docker/Postgres/S3）暂缓。
2. 向量/BM25 记忆检索暂缓。
3. 高级 persona hook/插件化暂缓。

## 回归验证现状

1. 已通过（带 web-api polyfill）的后端关键测试：
- `tests/backend/gateway.router.test.mjs`
- `tests/backend/gateway.persistence.test.mjs`
- `tests/backend/storage.sqlite.test.mjs`
- `tests/backend/protocol.contract.test.mjs`
- `tests/backend/tool-executor.driver.test.mjs`

2. 运行全量 `backend-test` 仍受环境限制影响：
- 某些环境缺少 `TransformStream`（已可通过 polyfill 绕过）。
- 沙箱环境可能禁止本地端口监听（`EPERM`），相关网络测试需在允许监听的环境跑。
