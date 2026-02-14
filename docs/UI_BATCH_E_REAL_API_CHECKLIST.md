# Batch E：UI 端真实字段接入清单（可直接开工）

更新时间：2026-02-13  
范围：仅 `apps/desktop` 与 `apps/web-console`，不涉及 cloud

## 0. 执行顺序（建议按此开工）

1. 先改 API Client（统一类型与方法），再改页面。
2. 先 Desktop（复用现有 gateway client），再 Web Console（去静态 mock）。
3. 每完成一个页面就做一次手工联调（连本地 gateway）。

---

## 1) Desktop：`gateway-client`（先做）

文件：`/Users/rqq/openFoal/apps/desktop/src/lib/gateway-client.ts`

最小改动点：
1. 扩展 `GatewayMethod`：
- 增加 `policy.get`、`policy.update`、`（已移除）`、`（已移除）`、`audit.query`、`metrics.summary`。
2. 扩展 side-effect 集合：
- `SIDE_EFFECT_METHODS` 增加 `policy.update`、`（已移除）`。
3. 扩展 `GatewaySession` 类型：
- 增加 `contextUsage`、`compactionCount`、`memoryFlushState`、`memoryFlushAt?`。
4. 更新 `isGatewaySession` 校验：
- 校验新增字段类型（允许 `memoryFlushAt` 缺省）。
5. 新增最小 API 方法：
- `getPolicy(scopeKey?: string)`
- `updatePolicy(patch, scopeKey?: string)`
- `listApprovals(params?: {status?: "pending"|"approved"|"rejected"; runId?: string; sessionId?: string})`
- `resolveApproval(params: {runId: string; decision: "approve"|"reject"; reason?: string})`
- `getMetricsSummary()`
- `queryAudit(params?)`（先返回空列表也可，保持契约）
6. `setRuntimeMode` 改为返回 payload（至少带 `status`、`effectiveOn?`），供 UI 提示 queued/applied。

验收：
1. TS 无报错。
2. 能通过 client 直接拿到 `sessions.get` 的新增字段。

---

## 2) Desktop：Store 类型对齐

文件：`/Users/rqq/openFoal/apps/desktop/src/store/app-store.ts`

最小改动点：
1. `SessionItem` 增加：
- `contextUsage: number`
- `compactionCount: number`
- `memoryFlushState: "idle" | "pending" | "flushed" | "skipped"`
- `memoryFlushAt?: string`
2. `upsertSession` 与排序逻辑保持不变，只做字段透传。
3. 如需兼容老数据：`setSessions` 前做一次缺省填充（默认 `0/0/"idle"`）。

验收：
1. 刷新后会话列表仍可正常显示。
2. 新增字段可被页面消费（不再丢失）。

---

## 3) Desktop：侧边栏会话信息最小升级

文件：`/Users/rqq/openFoal/apps/desktop/src/components/AppSidebar.tsx`

最小改动点：
1. `mapGatewaySessionToStoreSession` 映射新增字段。
2. 会话列表项最小展示增强：
- `title` 下增加 `preview`（单行截断）。
- 增加 `runtimeMode` 与 `syncState` 标签（小尺寸）。
3. 运行模式切换提示：
- 使用 `setRuntimeMode` 返回值显示 `queued-change` 或 `applied`，替换当前固定文案。

验收：
1. 切换模式时可看到“本轮后生效/已生效”区别。
2. 会话列表数据完全来自真实 `sessions.list/get`。

---

## 4) Desktop：聊天页状态栏与策略门禁感知

文件：`/Users/rqq/openFoal/apps/desktop/src/pages/ChatView.tsx`

最小改动点：
1. 页面加载与每次 `agent.run` 后，调用 `sessions.get` 刷新会话详情。
2. 在顶部 `gateway-status-bar` 增加三项显示：
- `contextUsage`（百分比）
- `compactionCount`
- `memoryFlushState`（idle/pending/flushed/skipped）
3. 增加 `agent.failed` 事件处理：
- 插入 system 消息，展示 `runId/toolName/runId`。
- 文案提示“需在控制台策略门禁后继续”。
4. 增加 `（已移除）d` 事件处理：
- 插入 system 消息，展示 `status/decision/reason`。

验收：
1. 触发高风险工具时，聊天流里能看到策略门禁提示。
2. 会话状态栏能实时显示新增元数据。

---

## 5) Web Console：去静态 mock（核心）

文件：`/Users/rqq/openFoal/apps/web-console/src/App.tsx`

最小改动点：
1. 删除顶部静态数组：
- `sessions`、`controls`、`audits`。
2. 增加页面状态：
- `loading`、`error`
- `sessions`、`policy`、`controls`、`audits`、`metrics`
3. `useEffect` 首次加载并并发请求：
- `sessions.list`
- `policy.get`
- `（已移除）`
- `audit.query`
- `metrics.summary`
4. 卡片字段改为真实字段：
- 会话卡：`id/title/runtimeMode/syncState/updatedAt`
- 策略卡：`toolDefault/highRisk/bashMode/version/updatedAt`
- 策略门禁卡：`runId/toolName/runId/status`
- 审计卡：`action/actor/createdAt`
- KPI 卡：`runsTotal/runsFailed/toolCallsTotal/toolFailures/p95LatencyMs`
5. 策略门禁卡增加两个按钮：
- Approve -> `（已移除）(decision="approve")`
- Reject -> `（已移除）(decision="reject")`
- 完成后刷新 `（已移除）` 与 `metrics.summary`。

验收：
1. 页面刷新后不再看到硬编码 mock 数据。
2. 策略门禁按钮可直接驱动后端状态变化。

---

## 6) Web Console：新增最小 API Client（建议）

新增文件：`/Users/rqq/openFoal/apps/web-console/src/lib/gateway-client.ts`

最小改动点：
1. 复用 desktop client 的 `req/res/event` 封装思路。
2. 只实现本页面需要的方法：
- `connect`（内部自动）
- `listSessions`
- `getPolicy`
- `listApprovals`
- `resolveApproval`
- `queryAudit`
- `getMetricsSummary`
3. baseUrl 读取：
- `VITE_GATEWAY_BASE_URL`，默认 `http://127.0.0.1:8787`。

验收：
1. `App.tsx` 不再直接写 `fetch` 细节。
2. 错误处理统一为 `GatewayRpcError`。

---

## 7) 文案与类型补齐（收尾）

文件：
- `/Users/rqq/openFoal/apps/desktop/src/locales/zh-CN.ts`
- `/Users/rqq/openFoal/apps/desktop/src/locales/en-US.ts`

最小改动点：
1. 增加会话状态栏文案 key：
- `contextUsage`
- `compactionCount`
- `memoryFlushState`
- `approvalRequired`
- `approvalResolved`
2. 保持中英文 key 对齐。

验收：
1. 页面不出现裸 key。
2. 中英文切换无缺词。

---

## 8) 联调检查（完成定义）

1. Desktop 进入某会话后，状态栏能看到 `contextUsage/compactionCount/memoryFlushState`。
2. Desktop 触发 `bash.exec` 时，能看到 `agent.failed` 提示。
3. Web Console 策略门禁卡能看到 pending 项并可 approve/reject。
4. approve 后，Desktop 对应 run 可继续完成；reject 后 run 失败且有解释。
5. Web Console KPI 展示真实 `metrics.summary` 字段，不再是占位数字。
