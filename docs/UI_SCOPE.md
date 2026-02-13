# UI 原型范围

## 企业级 Web（控制台）

必须有：

1. Workspace/Agent 切换
2. 会话列表与会话详情
3. 模型策略（allowlist/fallback/budget）
4. 工具策略（deny/allow/approval）
5. 审批中心（高风险工具）
6. 审计日志（筛选、检索、导出入口）
7. 运行健康（QPS、错误率、延迟）

## 个人版桌面（Web 视图）

必须有：

1. 主对话视图（流式输出 + 工具执行卡片）
2. 记忆侧栏（MEMORY + daily memory）
3. 会话上下文使用量
4. 模型切换与思考等级
5. 工具开关与风险提示

## 视觉级别

当前阶段仅低保真原型：

- 重信息结构，不重视觉细节
- 可点击跳转可后置
- 每个页面要标注“未来绑定数据源”

## 绑定 API 字段（V1）

详细映射见：[UI 到 API 映射](./UI_API_MAPPING_V1.md)

### Desktop 关键绑定字段

1. `agent.run`: `sessionId`, `input`, `runtimeMode`, `idempotencyKey`
2. `agent.delta`: `runId`, `delta`, `seq`
3. `sessions.list`: `id`, `title`, `updatedAt`, `runtimeMode`, `syncState`
4. `sessions.get`: `contextUsage`, `compactionCount`, `memoryFlushState`
5. `runtime.setMode`: `sessionId`, `runtimeMode`, `idempotencyKey`

### Web Console 关键绑定字段

1. `sessions.list`: `channel`, `target`, `status`
2. `policy.get/update`: `toolPolicy`, `modelPolicy`, `patch`
3. `approval.queue/resolve`: `approvalId`, `toolName`, `decision`, `status`
4. `audit.query`: `action`, `actor`, `resource`, `createdAt`
5. `metrics.summary`（预留）: `qps`, `errorRate`, `p95`, `cost`
