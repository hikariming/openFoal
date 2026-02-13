# OpenFoal Backend Architecture v1

## 目标与边界

本架构用于 OpenFoal v1 的后端落地，目标是让 Desktop 与 WebChat 能在统一控制平面下稳定运行，并支持 `本地运行` 与 `云端沙盒` 双模式。

v1 固定约束：

1. 单租户，不实现多租户 RBAC/SSO。
2. 后端主栈固定为 Node.js + TypeScript。
3. 云端执行隔离固定为 Docker，不引入 microVM。
4. 云端持久化固定为 Postgres + 对象存储（S3/MinIO 兼容）。
5. 入口优先级固定为 Desktop + WebChat，Slack/Telegram 等渠道后置。

关联文档：

- [Agent 设计](./AGENT_DESIGN_V1.md)
- [协议契约](./API_CONTRACT_V1.md)
- [实施路线图](./IMPLEMENTATION_ROADMAP_V1.md)
- [UI 到 API 映射](./UI_API_MAPPING_V1.md)

## 分层架构

```text
Desktop / WebChat / Web Console
        |
        v
Gateway (WS + HTTP)
  - auth / router / session / policy / approval / eventbus
        |
        v
Core Runtime (pi wrapper)
  - run / continue / abort / context transform
        |
        v
Tool Executor
  - local driver (bash/file/http)
  - cloud driver (docker sandbox)
        |
        v
Storage
  - local: SQLite + transcript jsonl + memory markdown
  - cloud: Postgres + object storage
```

组件职责：

1. `apps/gateway`：控制平面与协议入口，负责状态与策略编排。
2. `packages/core`：封装 agent loop，屏蔽底层 runtime 细节。
3. `packages/tool-executor`：统一工具执行接口，按运行模式选择 driver。
4. `packages/storage`：统一仓储接口，切换本地与云端实现。
5. `packages/model-adapters`：模型 allowlist、fallback、预算与超时策略。
6. `packages/skill-engine`：技能发现、加载、校验与审计。
7. `packages/protocol`：请求/响应/事件 schema 与类型共享。

### gateway -> core -> executor -> storage 时序（文字版）

1. Client 发送 `agent.run` 到 Gateway。
2. Gateway 完成鉴权、会话锁、防重入与策略快照。
3. Gateway 调用 Core `run(input)`，以流式事件消费执行过程。
4. Core 触发 tool call 时，委托 Executor 执行：
   - `runtimeMode=local` 走本地 driver。
   - `runtimeMode=cloud` 走 Docker driver。
5. Executor 返回结果后，Core 继续推理直到完成。
6. Gateway 将流式事件转发给 Client，并把会话、消息、工具运行和审计写入 Storage。
7. Gateway 返回 `agent.completed` 与最终 `res`。

## 运行模式（本地/云端沙盒）

### 本地运行（`runtimeMode=local`）

1. Gateway 与 Executor 均在本机进程或本机服务。
2. 会话与记忆默认仅落本地存储（SQLite + 文件）。
3. 适合离线可用与隐私优先场景。

### 云端沙盒（`runtimeMode=cloud`）

1. Gateway 与 Cloud Executor 在云主机。
2. 工具执行在 Docker 隔离容器。
3. 会话索引写 Postgres，transcript 与附件写对象存储。
4. 适合一致性执行环境与远程任务场景。

### 模式切换规则

1. 切换粒度：会话级。
2. 仅 `idle` 会话即时切换。
3. `running` 中切换请求排队，下一 turn 生效。
4. 运行中不会迁移当前 run 的执行位置。

## Gateway 模块

Gateway 模块固定拆分如下：

1. `auth`：`connect` 握手鉴权、token 校验、客户端身份识别。
2. `router`：把 `(workspace, agent, peer, thread)` 路由到会话与执行上下文。
3. `session`：会话创建/读取/锁定/重置、防并发重入。
4. `policy`：模型策略、工具策略、审批策略与风险分级。
5. `approval`：高风险工具待审队列、审批结果回写与恢复执行。
6. `eventbus`：向 Desktop/WebChat/Web Console 广播事件流。
7. `ratelimit`：按用户、会话、接口维度限流。
8. `audit`：全链路审计记录（请求、策略变更、工具执行、审批操作）。

## 存储设计

### 本地存储

1. 索引层：SQLite（sessions/messages/tool_runs/policy/audit）。
2. 记录层：`transcripts/<sessionId>.jsonl`（append-only）。
3. 记忆层：`MEMORY.md` + `memory/YYYY-MM-DD.md`。

### 云端存储

1. 元数据层：Postgres。
2. 记录层：对象存储（S3/MinIO 兼容）。
3. 可选缓存：后续阶段再引入（v1 不强制）。

### Repository 抽象

1. `SessionRepo`
2. `MessageRepo`
3. `ToolRunRepo`
4. `PolicyRepo`
5. `ApprovalRepo`
6. `AuditRepo`

## 安全基线

1. 默认拒绝：工具默认 `deny`，按 agent 显式放行。
2. 高风险工具默认 `approval-required`。
3. `bash.exec` 默认 sandbox，禁止无约束主机执行。
4. 网络访问默认 allowlist，拒绝任意外联。
5. 所有 side-effect 请求必须带 `idempotencyKey`。
6. 全链路审计默认开启，不可关闭核心审计字段。

## 可观测性

指标：

1. Gateway：QPS、P95/P99、5xx、限流命中率。
2. Core：run latency、平均工具调用数、中断率。
3. Executor：成功率、超时率、容器启动耗时。
4. Model：tokens、cost、fallback 率、超时率。
5. Approval：待审数量、平均审批时延、拒绝率。

链路追踪：

1. `trace_id`：端到端请求。
2. `run_id`：单次 agent 执行。
3. span 链路：`connect -> route -> run -> tool -> persist -> emit`。

## 部署拓扑

### 个人本地

1. 进程：Desktop + Gateway + Core + Local Executor。
2. 存储：SQLite + 本地文件。
3. 网络：默认 loopback。

### 单租户云

1. Gateway：1~N 个无状态实例。
2. Executor：Docker worker 池。
3. 存储：Postgres + 对象存储。
4. 访问：WebSocket + HTTPS 管理面。

## 故障恢复

1. 模型失败：先 provider 内重试，再 model fallback。
2. 执行失败：工具级失败写审计并返回结构化错误，不吞错。
3. Gateway 重启：基于会话索引与 transcript 进行恢复，不依赖内存状态。
4. 同步失败：进入重试队列，超阈值进入死信队列并告警。
5. 容器异常：销毁后自动重建，失败时降级返回并提示切本地模式。
