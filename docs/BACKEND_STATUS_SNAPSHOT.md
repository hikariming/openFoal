# 后端现状快照（基于当前代码）

更新时间：以当前仓库 `main` 代码为准。

## 已完成（可运行）

### 1) Protocol 层（`packages/protocol`）

- 已定义方法枚举：`connect`、`agent.run`、`agent.abort`、`runtime.setMode`、`sessions.list/get`、`policy.get/update`、`approval.queue/resolve`、`audit.query`、`metrics.summary`。
- 已定义事件枚举：`agent.accepted/delta/tool_call/tool_result/completed/failed`、`runtime.mode_changed`、`session.updated`、`approval.required/resolved`。
- 已定义标准错误码集合。
- 已实现 `validateReqFrame`：
  - 校验 `req` 结构；
  - 校验 method 是否存在；
  - 强制 side-effect 方法必须携带 `idempotencyKey`。

### 2) Gateway 路由层（`apps/gateway`）

- 已实现连接状态模型（连接态、事件序号、状态版本、会话运行锁、模式切换队列）。
- 已实现通用请求入口：
  - 参数校验；
  - 未 `connect` 前拒绝其他方法；
  - side-effect 请求的幂等缓存与冲突检测。
- 已实现核心路由能力：
  - `connect`；
  - `sessions.list/get`；
  - `runtime.setMode`（运行中排队，空闲时应用）；
  - `agent.run`（接 core 事件流并映射为协议事件）；
  - `agent.abort`；
  - `policy.get/update`（当前为默认策略 + 回显更新）；
  - `approval.queue/resolve`（当前为占位实现）；
  - `audit.query`（当前为占位实现）；
  - `metrics.summary`（当前为占位实现）。

### 3) Core 层（`packages/core`）

- 已定义 `CoreService` 接口：`run/continue/abort`。
- 已提供 `createMockCoreService`：可产出 `accepted -> delta -> completed` 的 mock 事件流。

### 4) Storage 层（`packages/storage`）

- 已定义 `SessionRepository` 接口。
- 已实现 `InMemorySessionRepository`，支持：
  - `list/get/upsert/setRuntimeMode`；
  - 默认种子会话。

### 5) Tool Executor 层（`packages/tool-executor`）

- 已定义 `ToolExecutor.execute()`、`ToolCall`、`ToolContext`、`ToolResult` 类型接口。
- 尚未提供 local/cloud driver 实现。

### 6) 测试基线

- 已有后端测试：
  - 协议校验测试（method 校验、side-effect 幂等键要求）；
  - 网关路由测试（connect 约束、agent.run 事件流、幂等重放/冲突、模式切换排队与应用）。

---

## 下一步建议（优先级）

### P0（先补“能跑真链路”）

1. **Gateway 网络服务化**
   - 当前是纯路由函数，需补 WS/HTTP server 启动与真实连接管理。
2. **Core 接真实 runtime**
   - 用真实模型调用替换 `createMockCoreService`，打通 tool loop。
3. **Tool Executor 落地 local driver**
   - 先支持 `bash/file/http` 最小闭环，建立统一执行结果与错误语义。
4. **Storage 从内存切 SQLite**
   - 至少补 `sessions + messages/transcript` 持久化，保证重启可恢复。

### P1（补“可运维可治理”）

5. **policy / approval / audit 真数据化**
   - 当前多数接口为占位返回，需接 repository 与审计流水。
6. **幂等持久化**
   - 当前幂等缓存在进程内存，重启丢失；需持久化并按 TTL 清理。
7. **metrics.summary 真指标**
   - 接入 run 成功率、时延、失败原因等统计。

### P2（补“云端与企业能力”）

8. **cloud runtime + Docker sandbox**
   - 完成 `runtimeMode=cloud` 的真实隔离执行路径。
9. **同步状态与冲突处理**
   - 兑现 `syncState(local_only/syncing/synced/conflict)` 的生命周期。
10. **多租户预留字段落库**
    - 当前代码未见 `tenant_id` 贯穿，建议在 schema 与 repository 先加字段与索引预留。

---

## 一句话结论

后端已经从“纯文档阶段”进入“协议 + 路由 + mock core + 内存存储 + 基础测试”的**可联调骨架阶段**，下一阶段重点是把 mock/内存/占位接口逐步替换成真实服务与持久化实现。
