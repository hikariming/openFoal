> [!WARNING]
> ARCHIVED (2026-02-14): This document is kept for historical reference only.
> Active source of truth: `/Users/rqq/openFoal/docs/PRODUCT_TRUTH.md`.
> Do not use this file for planning or implementation.

# OpenFoal 个人版 / 企业版关系与演进（v1）

## 1. 目标结论

OpenFoal 采用“一套核心、两种产品形态”：

1. 个人版：本地优先，单用户，快速可用。
2. 企业版：多租户管控，团队协作，成本与安全可控。

两者共用同一套 Agent Core，不做两套 Runtime。

---

## 2. 个人版与企业版的关系

### 2.1 共用能力（同一内核）

1. 会话与记忆机制。
2. 模型调用与工具调用主流程。
3. Gateway 协议与事件模型（核心结构一致）。

### 2.2 差异能力（壳层差异）

1. 个人版：本地数据、本地配置，访问支持“Desktop + Web 浏览器”双入口。
2. 企业版：多用户与多工作区、集中配置、预算与审计、统一运维。

---

## 3. 企业版核心能力（精简版）

企业版优先做这 5 类能力：

1. 策略下发：模型/工具/网络等基础策略统一下发。
2. 资产下发：企业知识文件、模板、技能包统一分发。
3. 企业记忆：团队共享知识库 + 会话记忆分层。
4. 额度预算：token、模型成本、工具调用频次的租户级限额。
5. 审计追踪：关键操作、策略变更、执行记录可查询。

说明：不引入人工审核流，保留自动策略门禁与审计即可。

---

## 4. 工具策略：从“人工审核”改为“极简门禁”

当前策略决策：

1. 不做人工审核 API/审核卡片/审核队列。
2. 不做复杂细粒度策略编排。
3. 仅保留极简工具白名单（可理解为简化版 allow/deny）。

建议落地方式：

1. 个人版：固定工具集，尽量不暴露策略 UI。
2. 企业版：使用静态工具白名单 Profile。
3. 高风险工具（如 `bash.exec`、`file.write`、外网 `http.request`）默认关闭，仅在企业配置中显式开启。

---

## 5. Docker 与浏览器的定位

### 5.1 企业用户是否“Docker + 浏览器”

结论：是，但角色不同。

1. 浏览器：企业管理员/运营通过 Web Console 使用管理功能。
2. Docker：用于后端部署与执行隔离，不是终端用户客户端。

### 5.2 终端用户入口

企业终端用户通常通过以下入口与 Agent 交互：

1. IM 渠道（Slack/Telegram/Discord/WhatsApp）。
2. Web 聊天入口（可选）。
3. 桌面端（可选）。

### 5.3 个人版的浏览器访问能力

结论：支持，作为个人版可选访问入口。

1. Desktop 模式：本机安装桌面端（默认）。
2. Web 模式：通过浏览器直接访问助手，不依赖本机桌面安装。
3. 老系统场景（如 Win7 无法安装桌面端）：使用 Web 入口作为兼容方案。

---

## 6. 推荐架构形态

### 6.1 个人版（Desktop-First）

1. 本机运行 Gateway + Core + 本地存储。
2. 本地文件与本地记忆。
3. 访问入口支持：
   - `desktop`：本机桌面端。
   - `web`：浏览器访问（兼容无法安装桌面端的设备）。
4. 最小配置、最少运维。

### 6.2 企业版（Cloud-Managed）

1. Web Console + API + IM 接入。
2. Gateway/执行层容器化（Docker，规模化后可上 K8s）。
3. 多租户隔离、预算控制、审计查询。

补充：个人版的 `web` 入口是“助手使用入口”，不等同于企业控制台。

---

## 7. MVP 边界（你当前方向）

### 7.1 必做

1. 企业记忆（团队知识 + 会话记忆）。
2. 额度与预算统计（至少 token/cost）。
3. 工具静态白名单（Profile 化）。
4. 审计查询（策略变更 + 关键执行）。
5. 个人版 Web 浏览器入口（最小可用版）。

### 7.2 延后

1. 复杂策略编排 UI。
2. 人工审核工作流。
3. 细粒度动态风险打分引擎。

---

## 8. 配置建议（示意）

```json
{
  "edition": "enterprise",
  "toolProfile": "enterprise-default",
  "accessChannels": ["desktop", "web"],
  "tools": {
    "math.add": "allow",
    "text.upper": "allow",
    "file.read": "allow",
    "file.write": "deny",
    "http.request": "deny",
    "bash.exec": "deny"
  },
  "budget": {
    "tokenDaily": 500000,
    "costMonthlyUsd": 300
  }
}
```

---

## 9. 一句话对外口径

OpenFoal 个人版解决“一个人好用”，企业版解决“一群人可控可管可审计”；两者同核，不走人工审核流，采用极简策略门禁。
