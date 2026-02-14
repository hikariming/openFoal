> [!WARNING]
> ARCHIVED (2026-02-14): This document is kept for historical reference only.
> Active source of truth: `/Users/rqq/openFoal/docs/PRODUCT_TRUTH.md`.
> Do not use this file for planning or implementation.

# OpenFoal Agent Design v1

关联文档：

1. [Backend 架构](./BACKEND_ARCHITECTURE_V1.md)
2. [API 契约](./API_CONTRACT_V1.md)
3. [实施路线图](./IMPLEMENTATION_ROADMAP_V1.md)
4. [UI 到 API 映射](./UI_API_MAPPING_V1.md)

## Agent 实体

v1 的 Agent 是一个可独立运行的执行单元，包含以下核心配置：

1. `AgentProfile`：名称、persona、workspace、默认模型、默认工具策略。
2. `SessionPolicy`：会话键规则、重置策略、compaction 策略、memory flush 策略。
3. `ExecutionPolicy`：sandbox 配置、网络白名单、策略门禁门禁。
4. `ModelPolicy`：allowed models、fallback chain、timeout、budget。

建议接口（统一到 `packages/core`）：

```ts
interface CoreService {
  run(input: CoreRunInput): AsyncIterable<CoreEvent>;
  continue(input: CoreContinueInput): AsyncIterable<CoreEvent>;
  abort(runId: string): Promise<void>;
}
```

会话扩展类型（统一到协议与存储）：

```ts
type Session = {
  id: string;
  sessionKey: string;
  runtimeMode: "local" | "cloud";
  syncState: "local_only" | "syncing" | "synced" | "conflict";
  updatedAt: string;
};
```

## Session Key 规范

v1 统一会话键结构：

1. 主会话：`workspace:<w>/agent:<a>/main`
2. 私聊：`workspace:<w>/agent:<a>/dm:<channel>:<peer>`
3. 群组：`workspace:<w>/agent:<a>/group:<channel>:<groupId>`
4. 线程：在上述 key 后追加 `:thread:<threadId>`

规范化规则：

1. 入站先做 channel 与 peer 格式标准化。
2. 路由层生成 canonical key，存储层仅接收 canonical key。
3. 旧 key（若存在）在读取层兼容映射，不再写回旧格式。

## Memory 分层

v1 采用 Markdown 双层记忆，文件是唯一事实源：

1. `MEMORY.md`：长期稳定偏好、规则、长期事实。
2. `memory/YYYY-MM-DD.md`：每日运行日志（append-only）。

注入策略：

1. 私聊主会话：注入 `MEMORY.md` + 最近 1~2 天 daily memory。
2. 群组会话：默认不注入 `MEMORY.md`，按需检索 daily 片段。

## Compaction/Pruning

必须区分两种机制：

1. `compaction`：把旧上下文摘要化并持久化到 transcript。
2. `pruning`：仅在单次请求前对旧 tool results 做临时瘦身，不落盘。

默认建议：

1. 优先修剪旧 `tool_result`，保留最近 N 条对话窗口。
2. 包含图像与关键结构化结果的工具输出默认不修剪。
3. compaction 完成后增加 `compaction_count` 并更新 session 元数据。

## Pre-compaction Memory Flush

在接近压缩阈值前触发一次静默记忆刷新：

1. 触发条件：`context_used > context_window - reserve_tokens_floor - soft_threshold`。
2. 执行方式：追加系统提示与用户提示，要求写入 memory 文件。
3. 输出约束：默认返回 `NO_REPLY`（用户不可见）。
4. 频率约束：每个 compaction 周期最多执行一次。
5. 只读工作区跳过：`workspaceAccess=ro/none` 时不执行。

## Tool Policy

v1 默认工具策略（写死）：

1. 默认 `deny`。
2. 高风险工具默认 `allow`。
3. `bash.exec` 默认 sandbox。
4. `http.request` 默认网络白名单。
5. `file.*` 允许范围受 workspace 与 policy 约束。

统一执行接口（落在 `packages/tool-executor`）：

```ts
interface ToolExecutor {
  execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult>;
}
```

## Approval 流程

策略门禁流固定为：

1. Gateway 接收到高风险 tool call。
2. 写入 `policy_history` 并发送 `agent.failed` 事件。
3. run 状态置为 `pending`。
4. 控制台调用 `（已移除）`（approve/reject）。
5. 若 approve：恢复 run 并继续 tool loop。
6. 若 reject：终止该 tool call，run 返回可解释错误并写审计。

## Model Fallback

失败处理顺序固定：

1. 当前 provider 内重试（含 auth profile rotation）。
2. 若仍失败，切换 `fallback chain` 的下一个模型。
3. fallback 耗尽后返回 `MODEL_UNAVAILABLE`。

默认建议：

1. provider 超时、限流、认证失败可触发 fallback。
2. 参数错误与策略拒绝不触发 fallback，直接返回业务错误。

## runtimeMode 会话级语义与切换规则

`runtimeMode` 为会话级状态，不是全局开关：

1. `local`：本地推理与本地工具执行。
2. `cloud`：云端推理/云端 Docker 工具执行。
3. 切换仅在 `idle` 状态立即生效。
4. 若会话在 `running`，切换请求标记为 `queued-change`，下一 turn 生效。
5. 切换不迁移当前 run 的执行位置，避免中途状态不一致。
