# OpenFoal Design

## 1. 设计目标

OpenFoal 是“基于 `pi` 的产品化扩展层”，目标是同时满足：

- 个人部署：本地可控、低成本、即装即用
- 企业部署：多租户隔离、可审计、可扩展

核心原则：

1. Reuse First：复用 `pi` 核心，不重复造轮子
2. Gateway First：所有接入统一进入控制平面
3. Policy First：访问控制优先于模型能力
4. Observable by Default：默认全链路可观测

## 2. 架构边界

### 2.1 pi 负责

- 模型调用抽象（providers/models）
- Agent 推理循环（turn -> tool call -> tool result）
- 技能基础机制（SKILL.md 按需加载）

### 2.2 OpenFoal 负责

- Gateway（鉴权、路由、会话、策略、事件）
- 渠道适配层（Slack/Telegram/Discord/...）
- 租户治理（RBAC、预算、审计）
- 执行隔离（sandbox、approval、network policy）

## 3. 分层与模块

## 3.1 Access Layer

职责：

- 处理渠道 webhook/socket 事件
- 渠道协议映射为统一事件
- 幂等去重与签名校验

统一入站事件：

```json
{
  "tenantId": "t_001",
  "workspaceId": "w_ops",
  "channel": "slack",
  "accountId": "bot-main",
  "peer": { "kind": "user", "id": "U123" },
  "threadId": "thread-optional",
  "message": {
    "id": "m_001",
    "text": "请检查今天报警",
    "attachments": []
  },
  "timestamp": 1730000000000
}
```

出站回复事件：

```json
{
  "channel": "slack",
  "accountId": "bot-main",
  "target": { "peerId": "U123", "threadId": "thread-optional" },
  "response": { "text": "处理完成", "attachments": [] }
}
```

## 3.2 Gateway Layer

Gateway 是 OpenFoal 控制平面。

核心模块：

- `auth`: API token/JWT/设备身份
- `router`: `(tenant, workspace, channel, peer, thread) -> (agent, session)`
- `session`: 会话创建、会话锁、并发防重入
- `policy`: DM策略、群组策略、工具策略、审批策略
- `ratelimit`: tenant/user/channel 维度限流
- `eventbus`: 向 UI/CLI/observability 推送事件

### 3.2.1 协议建议

- 控制面：WebSocket（双向、流式）
- 管理面：HTTP（配置、审计、健康检查）

WS 请求格式：

```json
{ "type": "req", "id": "r1", "method": "agent.run", "params": { "sessionId": "s1", "input": "..." } }
```

WS 响应格式：

```json
{ "type": "res", "id": "r1", "ok": true, "payload": { "runId": "run_123" } }
```

WS 事件格式：

```json
{ "type": "event", "event": "agent.delta", "payload": { "runId": "run_123", "delta": "..." } }
```

## 3.3 Core Layer（pi-based）

`packages/core` 封装 `pi-agent-core`，向 Gateway 暴露标准接口：

```ts
interface CoreService {
  run(input: CoreRunInput): AsyncIterable<CoreEvent>;
  continue(input: CoreContinueInput): AsyncIterable<CoreEvent>;
  abort(runId: string): Promise<void>;
}
```

执行流程：

1. Gateway 提供 `session + policy + model config`
2. Core 进行 context transform（裁剪/摘要/注入记忆）
3. 调用 `pi` 进行流式推理
4. 遇到 tool call 转给 Execution Layer
5. 写回 tool result 并继续推理
6. 生成完整输出并返回 Gateway

## 3.4 Skill Engine

职责：

- 发现技能（全局、工作区、项目级）
- 校验技能描述（name/description/结构）
- 按需加载 SKILL.md（progressive disclosure）
- 技能版本与来源追踪（企业需要审计）

建议能力：

- 技能白名单（tenant/workspace）
- 技能签名或来源校验（企业增强）
- 技能调用审计（何时、被哪个会话触发）

## 3.5 Execution Layer

统一工具执行接口：

```ts
interface ToolExecutor {
  execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult>;
}
```

MVP 工具：

- `bash.exec`
- `file.read`, `file.write`, `file.edit`
- `http.request`

策略控制：

- `mode=deny|allow|approval-required`
- sandbox profile（none/local/container/microvm）
- network egress allowlist

统一返回：

```json
{
  "ok": true,
  "content": [{ "type": "text", "text": "command output" }],
  "usage": { "durationMs": 842 },
  "error": null
}
```

## 3.6 Storage Layer

### 3.6.1 存储策略

- 个人版：SQLite + 本地文件
- 企业版：Postgres + 对象存储（S3/MinIO）

### 3.6.2 关键数据模型

- `tenants(id, name, status, plan)`
- `workspaces(id, tenant_id, name, status)`
- `agents(id, workspace_id, name, model_policy_json, tool_policy_json, status)`
- `sessions(id, agent_id, session_key, channel, peer_key, thread_key, state, updated_at)`
- `messages(id, session_id, role, content_json, token_input, token_output, cost, created_at)`
- `tool_runs(id, session_id, run_id, tool_name, args_json, result_json, status, created_at)`
- `audit_logs(id, tenant_id, actor, action, resource_type, resource_id, metadata_json, created_at)`

### 3.6.3 会话键建议

- 主会话：`tenant:<t>/workspace:<w>/agent:<a>/main`
- 私聊：`.../dm:<channel>:<peer>`
- 群组：`.../group:<channel>:<groupId>`
- 线程：在 key 追加 `:thread:<threadId>`

## 3.7 Session & Memory（吸收 OpenClaw 设计）

### 3.7.1 双层持久化（索引 + 记录）

OpenFoal 采用两层模型：

1. `sessions` 索引层（可变小数据）
2. `transcript` 记录层（JSONL 追加日志）

设计收益：

- 快速查询活动会话、token、路由元数据
- 对话历史保持可追溯，不因运行时剪枝而被改写
- 企业审计可直接关联 `session_key` 与 `run_id`

建议索引字段补充：

- `session_id`（当前活跃记录）
- `origin_meta`（channel/account/subject/thread）
- `token_counters`（input/output/context/total）
- `compaction_count`
- `memory_flush_at`

### 3.7.2 会话分桶与 DM Scope

借鉴 openclaw 的 `dmScope` 思路，OpenFoal 支持：

- `main`：所有私聊折叠到主会话（个人版默认）
- `per-peer`：按用户隔离
- `per-channel-peer`：按渠道+用户隔离（企业共享收件箱推荐）
- `per-account-channel-peer`：按账户+渠道+用户隔离（多账号企业场景）

可选 `identity_links` 将跨渠道账号映射为同一身份，实现“同一用户跨平台连续上下文”。

### 3.7.3 生命周期与重置

会话重置策略支持：

- `daily`：按网关本地时区固定时点重置（建议默认 04:00）
- `idle`：空闲超时重置
- `manual`：`/new`、`/reset`

当同时配置 `daily + idle` 时，采用“先到先触发”。

### 3.7.4 Compaction 与 Pruning 分离

OpenFoal 明确区分两类机制：

- `compaction`：将旧历史摘要写回 transcript（持久化）
- `context_pruning`：仅在单次模型请求前临时瘦身（不改磁盘）

默认规则建议：

- 只修剪旧 `toolResult`
- 保留最近 N 条 assistant 之后的工具结果不动
- 包含图像内容的工具结果默认不修剪

### 3.7.5 压缩前静默记忆刷新（Pre-Compaction Memory Flush）

当会话接近压缩阈值时，触发一次静默回合，将持久事实写入记忆文件。

关键点：

- 触发条件：`context_used > context_window - reserve_tokens_floor - soft_threshold`
- 默认静默：系统提示要求返回 `NO_REPLY`
- 每个压缩周期最多执行一次
- 工作区只读时跳过

这能降低“压缩后遗忘关键决策”的概率，是 OpenFoal 推荐默认开启的机制。

### 3.7.6 记忆文件分层

默认采用 Markdown 记忆分层：

- `MEMORY.md`：长期稳定偏好/规则/事实
- `memory/YYYY-MM-DD.md`：每日运行记录（append-only）

注入策略建议：

- 主私聊会话：加载 `MEMORY.md` + 最近 1-2 天 daily memory
- 群组会话：默认不加载 `MEMORY.md`，只按需读取 daily 片段

### 3.7.7 记忆检索（Hybrid）

记忆检索采用“向量 + BM25”混合检索：

- 向量：语义召回
- BM25：关键词精确召回（ID、错误码、符号名）
- 加权融合：`final = wv * vector + wt * bm25`

建议默认：

- `vectorWeight=0.7`
- `textWeight=0.3`
- `candidateMultiplier=4`

### 3.7.8 嵌入缓存与重建策略

为控制成本与延迟，引入嵌入缓存：

- 对未变化文本块复用 embedding
- 当 provider/model/chunk 参数变化时触发全量重建
- 监控记忆文件变化后增量同步（去抖动）

## 3.8 Models Layer

通过 `pi-ai` 适配，OpenFoal 增加策略层：

- provider/model allowlist
- fallback chain
- cost budget（per tenant/per workspace）
- timeout/retry policy

建议接口：

```ts
interface ModelPolicy {
  allowedProviders: string[];
  allowedModels: string[];
  fallback: Array<{ provider: string; model: string }>;
  maxCostPerRunUsd?: number;
  timeoutMs: number;
}
```

## 4. 多租户与权限模型

租户边界：`tenant_id` 是一等隔离键，贯穿路由、存储、缓存和日志。

权限模型建议：

- Role: `owner`, `admin`, `developer`, `viewer`, `auditor`
- Scope: `tenant`, `workspace`, `agent`
- Policy: 显式授权优先，默认拒绝

典型权限点：

- 修改模型策略
- 启用高风险工具
- 审批 exec 调用
- 查看审计日志与导出

## 5. 安全设计

默认安全基线：

1. DM 默认 `pairing/allowlist`，禁止默认开放
2. 工具默认 `deny`，按 agent 显式启用
3. `bash.exec` 默认 sandbox
4. 高风险调用可切换 `approval-required`
5. 全链路审计（输入、推理、工具、配置）

Prompt Injection 防护策略：

- 不信任输入内容（包括链接、附件、转发内容）
- 将“访问控制 + 工具策略”作为硬边界
- 敏感会话禁用 web/browse 类工具或启用更严格沙箱
- 对不可信输入会话启用更激进的 `context_pruning`
- 将“静默记忆刷新”输出限制为 `NO_REPLY`，避免中间内容外泄

## 6. 可观测性与运维

Metrics：

- Gateway: QPS、P95/P99、5xx、限流命中率
- Core: turn latency、平均工具调用数、流中断率
- Models: tokens、cost、超时率、fallback率
- Security: pairing请求、审批请求、拒绝数

Tracing：

- `trace_id`：一次端到端请求
- `run_id`：一次 agent 执行
- span链路：`access_in -> gateway_route -> core_run -> tool_execute -> gateway_out`

Ops：

- health endpoints: liveness/readiness
- graceful shutdown: 停止新请求，完成在途请求
- 回放机制：按 run_id 检索关键事件

## 7. 部署拓扑

### 7.1 个人版

- 进程：`desktop + gateway + core + executor`
- 存储：本地 SQLite + 文件
- 网络：默认 loopback，仅本机访问

### 7.2 企业版

- 网关：多实例无状态（共享 DB/Cache）
- 执行器：可独立扩展（按 tenant/workspace 调度）
- 存储：Postgres + 对象存储 + 可选缓存层
- 安全：统一 IdP/SSO + 审计归档

## 8. 渠道连接器规范（建议）

每个 connector 实现统一接口：

```ts
interface ChannelConnector {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(outbound: OutboundMessage): Promise<void>;
  onMessage(handler: (inbound: InboundMessage) => Promise<void>): void;
}
```

约束：

- connector 不直接调用模型
- connector 不保存业务状态
- connector 只负责协议适配与可靠投递

## 9. 里程碑

### M1: MVP

- Core 封装（pi-based）
- Gateway 最小闭环
- Slack connector + Tauri入口
- SQLite + 审计日志

### M2: Personal GA

- Skills 管理
- 记忆压缩
- 本地沙箱策略

### M3: Enterprise Beta

- 多租户 + RBAC
- 策略中心（模型/工具/预算）
- 网关与执行器扩展

### M4: Enterprise GA

- 多渠道规模化接入
- 合规导出与生命周期策略
- 运维与安全看板

## 10. 实施优先级（可直接开工）

1. `packages/protocol`：先固化 schema
2. `packages/core`：封装 pi runtime，统一 CoreService
3. `apps/gateway`：实现 auth + route + session + ws events
4. `packages/tool-executor`：先做 bash/file/http
5. `packages/channel-connectors/slack`
6. `apps/desktop`：打通本地端到端

## 11. 建议配置片段（记忆相关）

```json5
{
  session: {
    dmScope: "per-channel-peer",
    reset: { mode: "daily", atHour: 4, idleMinutes: 240 }
  },
  agents: {
    defaults: {
      compaction: {
        reserveTokensFloor: 20000,
        memoryFlush: {
          enabled: true,
          softThresholdTokens: 4000,
          prompt: "Write durable notes to memory/YYYY-MM-DD.md and return NO_REPLY."
        }
      },
      contextPruning: {
        mode: "cache-ttl",
        ttl: "5m"
      },
      memorySearch: {
        enabled: true,
        provider: "openai",
        model: "text-embedding-3-small",
        query: {
          hybrid: {
            enabled: true,
            vectorWeight: 0.7,
            textWeight: 0.3,
            candidateMultiplier: 4
          }
        },
        cache: { enabled: true, maxEntries: 50000 }
      }
    }
  }
}
```
