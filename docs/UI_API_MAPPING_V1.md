# OpenFoal UI ↔ API Mapping v1

本文件把当前原型页面与后端接口做字段级映射，作为前后端联调的唯一对齐文档。

关联文档：

- [Backend 架构](./BACKEND_ARCHITECTURE_V1.md)
- [Agent 设计](./AGENT_DESIGN_V1.md)
- [API 契约](./API_CONTRACT_V1.md)
- [实施路线图](./IMPLEMENTATION_ROADMAP_V1.md)

## Desktop 页面映射

### 1) 主对话页（`apps/desktop/src/pages/ChatView.tsx`）

| UI 区块 | API | 核心字段 | 备注 |
|---|---|---|---|
| 发送输入框 | `agent.run` | `sessionId`, `input`, `runtimeMode`, `idempotencyKey` | 新 turn 起点 |
| 流式回答区 | `agent.delta` event | `runId`, `delta`, `seq` | 增量渲染 |
| 工具执行卡片 | `agent.tool_call` / `agent.tool_result` event | `toolName`, `args`, `status`, `durationMs` | 展示执行过程 |
| 结束状态 | `agent.completed` / `agent.failed` event | `runId`, `status`, `summary|error` | 收尾与错误反馈 |

### 2) 左侧历史会话（`apps/desktop/src/components/AppSidebar.tsx`）

| UI 区块 | API | 核心字段 | 备注 |
|---|---|---|---|
| 会话列表 | `sessions.list` | `id`, `title`, `updatedAt`, `runtimeMode`, `syncState` | 替换本地 seed 数据 |
| 会话详情（上下文、压缩计数） | `sessions.get` | `contextUsage`, `compactionCount`, `memoryFlushState` | 用于右侧/状态栏展示 |

### 3) 运行模式设置（`AppSidebar` 设置面板）

| UI 区块 | API | 核心字段 | 备注 |
|---|---|---|---|
| 本地运行/云端沙盒切换 | `runtime.setMode` | `sessionId`, `runtimeMode`, `idempotencyKey` | 当前已具备 UI 入口 |
| 切换结果同步 | `runtime.mode_changed` event | `sessionId`, `runtimeMode`, `effectiveAt` | 前端更新状态标签 |

## Web Console 页面映射

### 1) 总览卡片（`apps/web-console/src/App.tsx`）

| UI 区块 | API | 核心字段 | 备注 |
|---|---|---|---|
| 活跃会话 | `sessions.list` | `id`, `title`, `updatedAt`, `runtimeMode`, `syncState` | 取代静态数组 |
| 策略概览 | `policy.get` | `scopeKey`, `toolDefault`, `highRisk`, `bashMode`, `tools`, `version`, `updatedAt` | 面板展示 |
| 策略门禁中心 | `（已移除）` | `runId`, `runId`, `toolCallId`, `toolName`, `status`, `decision`, `reason` | pending 队列 |
| 审计日志 | `audit.query` | `action`, `actor`, `resource`, `createdAt` | 列表与筛选 |
| 运行健康 | `metrics.summary` | `runsTotal`, `runsFailed`, `toolCallsTotal`, `toolFailures`, `p95LatencyMs` | 已接真实聚合 |

### 2) 策略操作

| UI 操作 | API | 核心字段 | 备注 |
|---|---|---|---|
| 修改工具策略 | `policy.update` | `patch.toolDefault/highRisk/bashMode/tools`, `idempotencyKey` | side-effect |
| 处理策略门禁 | `（已移除）` | `runId`, `decision`, `reason`, `idempotencyKey` | 策略门禁通过/拒绝 |

## 字段级绑定

### Session 类型扩展（必须在前后端统一）

```ts
type Session = {
  id: string;
  sessionKey: string;
  title: string;
  preview: string;
  runtimeMode: "local" | "cloud";
  syncState: "local_only" | "syncing" | "synced" | "conflict";
  contextUsage: number;
  compactionCount: number;
  memoryFlushState: "idle" | "pending" | "flushed" | "skipped";
  memoryFlushAt?: string;
  updatedAt: string;
};
```

### 工具执行与策略门禁字段（最小集）

```ts
type ToolRun = {
  runId: string;
  toolName: string;
  status: "pending" | "running" | "success" | "failed" | "pending";
  durationMs?: number;
  error?: string;
};

type ApprovalItem = {
  runId: string;
  runId: string;
  toolName: string;
  status: "pending" | "approved" | "rejected";
};
```

## 事件订阅

Desktop 必订阅：

1. `agent.accepted`
2. `agent.delta`
3. `agent.tool_call`
4. `agent.tool_result`
5. `agent.completed`
6. `agent.failed`
7. `runtime.mode_changed`
8. `session.updated`

Web Console 必订阅：

1. `session.updated`
2. `agent.failed`
3. `（已移除）d`
4. `agent.failed`（用于运维提示）

## 空态与错误态

### Desktop

1. 无会话：显示“创建新会话”空态，并禁用运行模式切换按钮。
2. 模式切换冲突：显示 `effectiveAt=next_turn` 提示，不中断当前 run。
3. 策略门禁阻塞：显示“等待策略门禁”状态，提供跳转控制台入口。
4. 执行失败：显示结构化错误码与 `trace_id`。

### Web Console

1. 策略门禁队列为空：显示空队列提示，不显示错误红条。
2. 审计为空：显示筛选条件建议与时间范围提示。
3. API 超时：使用可重试提示，保留上一次成功快照。
4. 未授权：统一跳转登录或展示 token 配置引导。
