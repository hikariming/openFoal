# Test Case Index

状态：ACTIVE  
适用范围：P1 / P2

## 1. 编号规范

1. P1 契约测试：`P1-CT-###`
2. P1 冒烟测试：`P1-SM-###`
3. P1 手工验收：`P1-MA-###`
4. P2 单元测试：`P2-UT-###`
5. P2 集成测试：`P2-IT-###`
6. P2 端到端测试：`P2-E2E-###`

约定：

1. 编号全局唯一，不复用、不回收。
2. `###` 从 `001` 递增。
3. PR 描述必须引用至少一个编号。

## 2. 用例到模块映射

| 用例前缀 | 主要模块 | 说明 |
|---|---|---|
| `P1-CT-*` | `packages/protocol`, `apps/gateway` | 网关协议与幂等契约 |
| `P1-SM-*` | `apps/personal-web`, `apps/gateway` | 个人 Web 冒烟主流程 |
| `P1-MA-*` | `apps/personal-web` | 人工端到端验收 |
| `P2-UT-*` | `apps/gateway`, `packages/storage` | 调度、预算、策略、审计逻辑 |
| `P2-IT-*` | `apps/gateway`, `packages/storage`, executor adapters | 双目标执行与数据一致性 |
| `P2-E2E-*` | `apps/web-console`, `apps/gateway` | 企业管控最小闭环 |

## 3. 自动化与手工归属

| 类别 | 自动化 | 手工 |
|---|---|---|
| `P1-CT-*` | 是（Node test） | 否 |
| `P1-SM-*` | 是（smoke baseline） | 可选补充 |
| `P1-MA-*` | 否 | 是（发布前必做） |
| `P2-UT-*` | 是 | 否 |
| `P2-IT-*` | 是 | 否 |
| `P2-E2E-*` | 是（阶段性） | 是（灰度前复核） |

## 4. 当前已登记用例（首批）

### P1

1. `P1-CT-001` connect 前禁止业务方法调用。
2. `P1-CT-002` `agent.run` 幂等重放与冲突。
3. `P1-SM-001` 首次进入可创建并切换会话。
4. `P1-SM-002` 发送消息看到 `agent.delta -> agent.completed`。
5. `P1-SM-003` 刷新后通过 `sessions.history` 回放最近消息。
6. `P1-SM-004` 策略拒绝显示 `POLICY_DENIED`。
7. `P1-SM-005` 网关不可达显示网络错误并可重试。
8. `P1-MA-001` 无桌面安装场景通过浏览器完成完整问答。
9. `P1-MA-002` 会话切换后上下文与历史隔离正确。
10. `P1-MA-003` 历史分页/刷新不丢最近消息。

### P2（预登记）

1. `P2-UT-001` 执行目标选择优先级正确。
2. `P2-UT-002` 预算超限硬拒绝。
3. `P2-UT-003` 工具白名单命中与拒绝正确。
4. `P2-IT-001` local-host 执行链路成功与失败。
5. `P2-IT-002` docker-runner 成功、超时、连接失败。
6. `P2-IT-003` 指标与预算消耗一致。
7. `P2-IT-004` 审计写入与查询过滤分页正确。
8. `P2-E2E-001` 控制台预算变更立即生效。
9. `P2-E2E-002` 控制台策略变更影响下次 run。
10. `P2-E2E-003` 审计页可追溯拒绝与策略变更事件。
11. `P2-E2E-004` 启动 mock docker-runner + gateway + web-console，验证审计筛选/分页链路。

自动化脚本映射：

1. `P2-E2E-004` 对应命令：`npm run test:p2:e2e`
