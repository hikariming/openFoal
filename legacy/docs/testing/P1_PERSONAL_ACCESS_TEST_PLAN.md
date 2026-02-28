# P1 Personal Access Test Plan

状态：ACTIVE  
阶段：Week 1-3  
目标：个人 Web 聊天入口可稳定替代无法安装 Desktop 的使用场景。

## 1. 范围与非范围

### 1.1 范围（In Scope）

1. 个人 Web 聊天入口核心流程：
   - 会话列表
   - 会话创建与切换
   - 消息发送与流式渲染
   - 历史回放
2. 网关协议复用验证（不新增协议）。
3. 错误处理与重试体验。

### 1.2 非范围（Out of Scope）

1. 企业控制台能力（预算、租户管理、审计检索页面）。
2. 复杂权限系统与 SSO。
3. 复杂多端同步冲突解决。

## 2. 测试分层

### 2.1 契约测试（Contract）

目标：验证 P1 对网关协议的依赖稳定性。

1. `P1-CT-001` connect 前禁止业务方法。
2. `P1-CT-002` `agent.run` 幂等重放与冲突。

执行方式：

1. Node test（复用 backend 测试体系）。
2. 纳入 `test:p1:smoke` 基线流程。

### 2.2 冒烟测试（Smoke）

目标：验证浏览器主路径“能用且可解释失败”。

1. `P1-SM-001` 首次进入可创建并切换会话。
2. `P1-SM-002` 发送消息可见 `agent.delta -> agent.completed`。
3. `P1-SM-003` 刷新后能回放最近历史。
4. `P1-SM-004` 策略拒绝显示 `POLICY_DENIED`。
5. `P1-SM-005` 网关不可达显示网络错误并可重试。

执行方式：

1. 自动化 smoke（当前阶段可先 Node 基线）。
2. 后续可升级到 Playwright UI smoke。

### 2.3 手工验收（Manual Acceptance）

目标：覆盖自动化难以表达的可用性路径。

最少 8 条关键路径，含：

1. 首次打开、创建会话、发送消息、切换会话。
2. 刷新页面后历史一致性。
3. 错误恢复与重试操作可达。
4. 在无 Desktop 安装场景可独立完成回合。

## 3. 环境与数据准备

### 3.1 环境

1. 启动 Gateway：
   - `npm run dev:gateway`
2. 启动 Personal Web：
   - `npm run dev:personal-web`
3. 个人版认证口径：
   - `OPENFOAL_AUTH_MODE=none`
   - `OPENFOAL_ENTERPRISE_REQUIRE_AUTH=false`
   - Personal 路径默认不依赖登录。

### 3.2 测试数据

1. 默认会话：`s_default`（如不存在则创建）。
2. 默认策略：
   - `toolDefault=deny`
   - `highRisk=allow`
3. 用于拒绝路径的策略样例：
   - `tools["bash.exec"]="deny"`

## 4. 用例清单

| ID | 前置条件 | 步骤 | 期望 |
|---|---|---|---|
| P1-CT-001 | 未发送 connect | 直接调用 `sessions.list` | 返回 `UNAUTHORIZED` |
| P1-CT-002 | 已 connect | 同 idempotencyKey 重放 + 参数变更重放 | 首次结果重放；参数变更返回 `IDEMPOTENCY_CONFLICT` |
| P1-SM-001 | 网关可达 | 打开页面，创建会话并切换 | UI 显示会话列表，切换生效 |
| P1-SM-002 | 活跃会话存在 | 发送消息 | 展示流式输出并最终完成 |
| P1-SM-003 | 有历史消息 | 刷新页面 | 历史消息可回放 |
| P1-SM-004 | `bash.exec=deny` | 触发高风险工具调用 | UI 出现可解释拒绝信息 `POLICY_DENIED` |
| P1-SM-005 | 网关断开或地址错误 | 发送消息并重试连接 | 显示网络错误；恢复后可继续发送 |

## 5. 回归清单与发布门禁

### 5.1 回归清单

1. `npm run test:backend`
2. `npm run test:p1:smoke`
3. 手工关键路径 8 条

个人版 Docker 冒烟建议顺序：

1. `npm run up:personal`
2. 访问 `http://127.0.0.1:5180` 完成首轮问答
3. `npm run logs:personal` 检查无阻塞错误
4. `npm run down:personal`

### 5.2 发布门禁

1. 自动化结果全绿。
2. 手工验收无阻塞项。
3. 失败路径具备用户可理解提示。
