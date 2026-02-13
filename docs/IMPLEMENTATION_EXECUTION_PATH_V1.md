# OpenFoal 实施路径（执行版 v1）

## 1. 文档目的

这是一份可直接执行的实施文档，基于当前仓库现状和既有设计文档，目标是让你按周推进并持续验收，不需要临时补关键决策。

输入基线文档：

1. `docs/BACKEND_ARCHITECTURE_V1.md`
2. `docs/AGENT_DESIGN_V1.md`
3. `docs/API_CONTRACT_V1.md`
4. `docs/IMPLEMENTATION_ROADMAP_V1.md`
5. `docs/UI_API_MAPPING_V1.md`
6. `docs/MULTI_TENANCY_DESIGN.md`
7. `docs/BACKEND_TEST_STRATEGY_V1.md`

## 2. 当前状态快照（按仓库事实）

截至当前状态，项目可视化原型已具备，但后端主链路尚未落地：

1. `apps/desktop`：已有可运行 UI（含“运行模式：本地运行/云端沙盒”设置入口）。
2. `apps/web-console`：已有控制台页面，但数据来自静态 mock。
3. `apps/prototypes/*`：低保真信息架构已完成。
4. `apps/gateway`：目录存在，但尚无实现文件。
5. `packages/*`：目录存在，但尚无实现文件。
6. 当前仍属于“前端原型领先、后端骨架待建”阶段。

这意味着 v1 实施主路径应为：先协议、再网关骨架、再本地闭环、再云沙盒、再控制台绑定。

## 3. 固定约束（本次执行必须遵守）

1. v1 单租户运行，不实现多租户 RBAC/SSO。
2. 代码必须保持多租户就绪：核心模型和存储预留 `tenant_id`。
3. 首发渠道仅 Desktop + WebChat，不并行接 Slack/Telegram。
4. 云隔离固定 Docker，不上 microVM。
5. 本地优先，云为可选增强。
6. 所有 side-effect API 必须携带 `idempotencyKey`。

## 4. 工作流分解（按模块并行）

### A. Protocol（`packages/protocol`）

1. 定义 `req/res/event` 三类帧 schema。
2. 固化方法：`connect`、`agent.run`、`agent.abort`、`runtime.setMode`、`sessions.list/get`、`policy.get/update`、`approval.queue/resolve`、`audit.query`。
3. 固化事件：`agent.accepted/delta/tool_call/tool_result/completed/failed`、`runtime.mode_changed`、`session.updated`、`approval.required/resolved`。
4. 生成 TS 类型与 JSON schema。

### B. Gateway（`apps/gateway`）

1. 搭建 WS 服务、握手鉴权、请求路由。
2. 实现 `session lock` 与防重入。
3. 实现 API 最小闭环：先 `connect + agent.run(mock) + sessions.list`。
4. 补齐 policy/approval/audit 的读写接口。

### C. Core（`packages/core`）

1. 落 `CoreService` 接口：`run/continue/abort`。
2. 接入 runtime loop（先最小单模型）。
3. 把 tool call 交由 executor，形成完整循环。

### D. Tool Executor（`packages/tool-executor`）

1. 统一 `ToolExecutor.execute()` 接口。
2. 本地 driver：`bash/file/http`。
3. 云 driver：Docker sandbox。
4. 风险工具接审批队列（`approval-required`）。

### E. Storage（`packages/storage`）

1. Repository 抽象层（Session/Message/ToolRun/Policy/Approval/Audit）。
2. 本地实现：SQLite + transcript jsonl + memory markdown。
3. 云实现：Postgres + 对象存储。
4. 为未来多租户预留 `tenant_id` 字段与复合索引。

### F. Desktop（`apps/desktop`）

1. 用 `sessions.list/get` 替换当前本地 seed。
2. 对话发送接 `agent.run`，流式接 `agent.delta`。
3. “运行模式”开关接 `runtime.setMode` 与 `runtime.mode_changed`。
4. 显示工具执行卡片与审批阻塞状态。

### G. Web Console（`apps/web-console`）

1. 会话卡片接 `sessions.list`。
2. 策略页接 `policy.get/update`。
3. 审批页接 `approval.queue/resolve`。
4. 审计页接 `audit.query`。
5. 指标卡预留 `metrics.summary`。

### H. QA/Observability（横切）

1. 建立 API contract tests（schema + 错误码）。
2. 建立执行链路 E2E（local/cloud）。
3. 打通 `trace_id/run_id` 到日志与审计。

## 5. 10 周执行计划（可直接按 Sprint 跑）

## Sprint 1（第 1-2 周）：协议与网关骨架

交付：

1. `packages/protocol` 首版 schema 与类型产物。
2. `apps/gateway` 可启动并处理 `connect`。
3. `agent.run(mock)` 事件流打通到 Desktop。

验收：

1. Desktop 可发消息并收到流式 mock 输出。
2. WS 请求/响应结构 100% 通过 schema 校验。

## Sprint 2（第 3-4 周）：本地运行闭环

交付：

1. `packages/core` + `packages/tool-executor(local)` 打通。
2. `packages/storage` 本地实现（SQLite + jsonl + memory）。
3. `sessions.list/get` 真数据化。

验收：

1. 本地模式可执行 `bash/file/http` 工具链路。
2. 会话与 transcript 可回放。

## Sprint 3（第 5-6 周）：云端沙盒闭环

交付：

1. Docker 执行器实现与容器生命周期管理。
2. `runtime.setMode` 与会话级切换落地。
3. 云端 Postgres + 对象存储接入。

验收：

1. 同一会话可切换云端并成功执行工具。
2. 模式切换遵守“running 排队、next turn 生效”。

## Sprint 4（第 7-8 周）：控制台绑定 + 同步

交付：

1. 控制台接入 `sessions/policy/approval/audit` 真 API。
2. 本地优先增量上云同步任务。
3. `syncState` 状态可见（`local_only/syncing/synced/conflict`）。

验收：

1. 审批通过后可恢复被阻塞 run。
2. 同步失败可重试，冲突可标识。

## Sprint 5（第 9-10 周）：硬化与发布准备

交付：

1. 鉴权、限流、幂等、防重入完善。
2. 指标与 trace 贯通。
3. 发布与运维文档完善。

验收：

1. 回归用例通过。
2. 无 P0/P1 阻塞问题。

## 6. 第一周直接执行清单（可复制到 Issue）

1. 初始化 `packages/protocol/package.json`、`tsconfig`、schema 目录。
2. 定义 `connect`、`agent.run`、`agent.delta` 最小协议。
3. 初始化 `apps/gateway`（WS server + health check + connect handler）。
4. Desktop 新增 WS client service（先打 mock event）。
5. 替换 desktop 输入框发送逻辑为 `agent.run`。
6. 建立 `docs/` 中 API 示例与代码注释的一致性检查脚本。

## 7. 实施中的“不可偏离项”

1. 不新增第二套协议格式（避免 JSON 结构分叉）。
2. 不绕过 `policy` 直接执行工具。
3. 不在 v1 引入多租户运行逻辑，但必须保留 `tenant_id` 字段。
4. 不把控制台继续当静态页面维护，必须尽早绑定真实 API。

## 8. 风险与处理

1. 风险：协议漂移（前后端字段不一致）。
   - 处理：protocol 包单一来源 + contract test gate。
2. 风险：云执行成本上升。
   - 处理：容器 TTL、并发限制、预算告警。
3. 风险：同步引发数据冲突。
   - 处理：本地优先 + append-only + `syncState=conflict`。
4. 风险：范围膨胀导致延期。
   - 处理：严格冻结 v1 范围，渠道后置。

## 9. 完成定义（DoD）

1. Desktop 与 WebChat 可以在本地和云端两种模式稳定对话。
2. 控制台核心页面（会话/策略/审批/审计）全部绑定真实 API。
3. 文档中的 API 名称、字段、状态枚举与代码一致。
4. 所有 side-effect 请求都有 `idempotencyKey` 校验。
5. 具备可回放、可审计、可追踪能力（`trace_id/run_id`）。

## 10. 关联文档

1. [Backend 架构（v1）](./BACKEND_ARCHITECTURE_V1.md)
2. [Agent 设计（v1）](./AGENT_DESIGN_V1.md)
3. [API 契约（v1）](./API_CONTRACT_V1.md)
4. [实施路线图（v1）](./IMPLEMENTATION_ROADMAP_V1.md)
5. [UI 到 API 映射（v1）](./UI_API_MAPPING_V1.md)
6. [多租户设计（演进版）](./MULTI_TENANCY_DESIGN.md)
7. [后端测试策略（v1）](./BACKEND_TEST_STRATEGY_V1.md)
