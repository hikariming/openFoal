# OpenFoal Product Truth（唯一真相）

更新时间：2026-02-14  
状态：ACTIVE（唯一产品口径与实施依据）

## 1. 定位与产品块

OpenFoal 统一为 3 个产品块：

1. Personal Runtime（当前主线）
   - 单用户
   - 本地数据
   - 本地执行
   - Desktop 可用
2. Personal Access（下一步）
   - 个人 Web 聊天入口
   - 面向无法安装桌面端的设备（如老系统）
3. Enterprise Control（后续）
   - 多租户
   - 额度与预算
   - 企业记忆
   - 审计
   - 策略下发

## 2. 当前真实状态（以代码为准）

### 2.1 已实现

1. Gateway 协议与主链路：
   - `connect`
   - `agent.run/agent.abort`
   - `runtime.setMode`
   - `sessions.create/list/get/history`
   - `policy.get/update`
   - `metrics.summary`
   - `memory.get/appendDaily/archive`
2. 策略门禁：
   - 仅 `allow/deny`
   - 已移除人工审核流
3. Desktop 可用：
   - 会话、聊天、流式事件渲染、运行模式切换、记忆操作
4. 数据存储：
   - SQLite + InMemory 仓储可运行
   - 会话、转录、幂等、策略、指标
5. P1 基线：
   - 已新增 `apps/personal-web` 最小聊天入口骨架
   - 已新增 `test:p1:smoke` 自动化基线

### 2.2 未实现 / 仅占位

1. `runtimeMode=cloud` 仅语义存在，尚未形成独立云执行闭环。
2. `audit.query` 当前为空实现（无真实查询结果）。
3. 企业多租户/RBAC/SSO 未落地。
4. 个人 Web 聊天入口已落地最小版本，仍需补齐更完整 UI 冒烟自动化。

### 2.3 本期不做（P0-P2 范围外）

1. 人工审核工作流。
2. 复杂策略编排 UI。
3. 全渠道连接器一次性接入。

## 3. P0（本周）目标与完成定义

目标：统一口径，停止文档误导。

### 3.1 必做

1. 固化本文件为唯一真相文档。
2. 旧文档统一标记 archived。
3. README 入口仅指向：
   - 本文件
   - 归档索引

### 3.2 DoD

1. 团队讨论、排期、开发均以本文件为准。
2. 任意旧文档打开首屏可见 ARCHIVED 警告。
3. 不再使用旧文档作为需求来源。

## 4. P1 工作（Personal Access）

目标：让个人用户可以通过浏览器直接使用助手。

### 4.1 范围

1. 新增个人 Web 聊天端（不是企业控制台）。
2. 复用现有 Gateway API。
3. 与 Desktop 共用会话与消息链路。

### 4.2 任务拆解

1. 前端应用：
   - 新建 `apps/personal-web`（或在现有 web 应用分离入口）
   - 页面：会话列表、聊天窗口、输入框、运行状态
2. Gateway 对接：
   - 接 `connect`、`sessions.list/get/history`、`agent.run`
   - 支持流式事件（`agent.delta`、`agent.completed`、`agent.failed`）
3. 用户体验最小集：
   - 基础错误提示
   - 会话创建/切换
   - 记忆读取入口（可选）
4. 发布方式：
   - 本机运行可访问
   - 文档给出“老系统通过浏览器访问”的使用说明

### 4.3 验收标准

1. 无桌面端时，浏览器可完成完整问答回合。
2. 同一会话历史可回看。
3. 失败场景可解释（网络失败、策略拒绝、工具失败）。

## 5. P2 工作（Enterprise Control）

目标：企业最小可用闭环，先实现你定义的核心价值。

### 5.1 范围（只做核心）

1. 额度与预算（token/cost）
2. 企业记忆（workspace 级）
3. 策略下发（静态白名单）
4. 审计最小闭环（`audit.query` 返回真实数据）

### 5.2 任务拆解

1. 指标与额度
   - 扩展 `run_metrics` 与成本字段
   - 提供按租户/工作区聚合接口
   - 增加预算阈值与超限策略（拒绝或降级）
2. 企业记忆
   - 设计 workspace 级 memory namespace
   - 明确读写边界（用户会话 vs 组织知识）
3. 策略下发
   - 维护工具白名单 Profile（最小配置）
   - 支持读取和更新（无复杂策略引擎）
4. 审计
   - 记录策略变更、关键工具执行、预算触发事件
   - `audit.query` 实现真实过滤和分页
5. Console
   - 先做可读与可操作最小页：预算、策略、审计

### 5.3 验收标准

1. 企业管理员可查看预算消耗与超限状态。
2. 企业策略更新可立即影响工具执行结果。
3. 审计可追溯“谁在何时做了什么变更/执行”。

## 6. 规则

1. 新需求先更新本文件，再进入开发。
2. 若实现与本文件冲突，以“先修文档再改代码”为原则。
3. 未进入本文件的事项，不进当前迭代。

## 7. Testing Baseline

当前测试基线文档（ACTIVE）：

1. `/Users/rqq/openFoal/docs/testing/TEST_CASE_INDEX.md`
2. `/Users/rqq/openFoal/docs/testing/P1_PERSONAL_ACCESS_TEST_PLAN.md`
3. `/Users/rqq/openFoal/docs/testing/P2_ENTERPRISE_CONTROL_TEST_PLAN.md`

执行约定：

1. 用例编号必须来自 `TEST_CASE_INDEX.md`。
2. 所有新功能 PR 必须绑定至少一个测试用例编号。
3. 自动化与手工验收均以测试文档为准，不再散落到旧规划文档。

## 8. Release Gates

### 8.1 全局门禁

1. `npm run test:backend` 必须全绿。
2. 变更说明必须包含影响范围与回滚方式。
3. 若触达协议或存储结构，必须补回归测试。

### 8.2 P1 门禁（Personal Access）

1. `npm run test:p1:smoke` 必须全绿。
2. 手工关键路径验收至少 8 条（登录入口、会话、聊天、历史、错误处理）。
3. 浏览器端在无桌面安装场景可独立完成问答回合。

### 8.3 P2 门禁（Enterprise Control）

1. P2 UT/IT 全绿（预算、策略、调度、审计）。
2. 审计查询必须返回真实数据（不允许占位空实现通过）。
3. 预算超限必须硬拒绝新 run，且拒绝事件可审计追踪。
