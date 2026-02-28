# P2 Enterprise Control Test Plan

状态：ACTIVE  
阶段：Week 4-7  
目标：建立企业最小可用闭环（预算、策略、审计、企业记忆）并验证双目标调度。

## 1. 架构与拓扑假设

### 1.1 固定模型

1. 企业持有 N 个 `agent_definition`（逻辑配置），不是 N 个常驻进程。
2. Gateway 按需调度执行，不将 agent 实例长期绑定。
3. 执行目标池同时支持：
   - `local-host`
   - `docker-runner`

### 1.2 固定执行链路

1. `agent.run` 进入 Gateway。
2. 解析 `tenant/workspace/agent_definition`。
3. 预算预检查（超限硬拒绝）。
4. 目标选择：显式目标 > agent 默认 > workspace 默认 > tenant 默认。
5. 分发执行并接收事件。
6. 写入指标、预算消耗、审计日志。

## 2. 测试矩阵（预算/策略/审计/企业记忆）

| 能力 | 单元测试 | 集成测试 | E2E |
|---|---|---|---|
| 预算与额度 | P2-UT-002 | P2-IT-003 | P2-E2E-001 |
| 策略门禁 | P2-UT-003 | P2-IT-001/P2-IT-002 | P2-E2E-002 |
| 审计查询 | P2-UT-*（过滤逻辑） | P2-IT-004 | P2-E2E-003 |
| 企业记忆 | P2-UT-*（namespace） | P2-IT-*（隔离读写） | 阶段性手工验收 |
| 认证与租户 | AUTH-UT-001~004 | AUTH-IT-* | AUTH-E2E-* |

## 3. 双目标执行链路测试

### 3.1 local-host

1. `P2-IT-001-A` 正常执行成功。
2. `P2-IT-001-B` 工具失败路径。
3. `P2-IT-001-C` 被策略拒绝路径。

### 3.2 docker-runner

1. `P2-IT-002-A` runner 可用时正常执行。
2. `P2-IT-002-B` runner 超时。
3. `P2-IT-002-C` runner 连接失败。

### 3.3 一致性验证

1. `P2-IT-003` 指标计数与预算扣减一致。
2. local 与 docker 路径写入的审计结构一致。

### 3.4 认证与租户联动验证（企业默认）

1. 企业默认模式：`OPENFOAL_AUTH_MODE=hybrid` + `OPENFOAL_ENTERPRISE_REQUIRE_AUTH=true`。
2. 所有治理写接口在 enterprise 环境必须先完成登录并携带 token。
3. 作用域强制收口：
   - tenant 不一致返回 `TENANT_SCOPE_MISMATCH`
   - workspace 越权返回 `WORKSPACE_SCOPE_MISMATCH`

## 4. 失败与降级策略测试

### 4.1 预算硬拒绝（默认策略）

1. 超限后新 run 直接拒绝。
2. 返回明确错误码与提示信息。
3. 审计记录必须包含拒绝原因与阈值快照。

### 4.2 执行目标失败

1. local-host 失败不应污染 docker 目标状态。
2. docker-runner 失败需记录目标级错误并可重试。
3. 不得返回成功态空结果。

## 5. 发布分阶段门禁

### 5.1 Week 4-6（后端核心）

1. P2 UT 全绿。
2. P2 IT 全绿。
3. `audit.query` 非占位实现（可查到真实记录）。
4. `npm run test:auth` 全绿（至少覆盖 AUTH-UT-001~004）。

### 5.2 Week 7（控制台闭环）

1. P2 E2E 冒烟全绿。
2. 控制台预算变更立即生效。
3. 控制台策略变更影响下次 run。
4. 审计页可追溯预算拒绝与策略变更。

### 5.3 联调脚本门禁（新增）

1. `npm run test:p2:e2e` 必须通过。
2. 联调脚本必须同时验证：
   - docker-runner 远程执行命中
   - `audit.query` 的筛选 + 分页闭环
3. `docker-runner` 协议冲突时以 `P2_DOCKER_RUNNER_HTTP_PROTOCOL.md` 为准。
4. Docker 企业链路建议额外执行：`npm run test:p2:e2e:docker`。

## 6. 关键测试用例（首批）

| ID | 场景 | 期望 |
|---|---|---|
| P2-UT-001 | 目标选择优先级 | 命中顺序符合固定规则 |
| P2-UT-002 | 预算超限 | 新 run 被硬拒绝 |
| P2-UT-003 | 工具白名单 | allow/deny 行为一致 |
| P2-IT-001 | local-host 链路 | 成功/失败均可追踪 |
| P2-IT-002 | docker-runner 链路 | 成功/超时/连接失败可区分 |
| P2-IT-003 | 指标与预算 | 数据一致且可汇总 |
| P2-IT-004 | 审计查询 | 过滤+分页正确 |
| P2-E2E-001 | 控制台预算更新 | 下一次 run 立即受影响 |
| P2-E2E-002 | 控制台策略更新 | 下一次 run 策略生效 |
| P2-E2E-003 | 审计追溯 | 关键事件可检索 |
