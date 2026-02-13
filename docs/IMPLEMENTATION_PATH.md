# OpenFoal 实施路径（先原型后功能）

## 1. 总体节奏

采用三段式推进：

1. 原型阶段（先设计）
2. 骨架阶段（再搭架构）
3. 功能阶段（最后做能力）

目标是先把企业版和个人版的交互路径固定，再避免后续功能返工。

## V1 文档导航

v1 的设计与实施细节已拆分为以下文档：

1. [Backend 架构](./BACKEND_ARCHITECTURE_V1.md)
2. [Agent 设计](./AGENT_DESIGN_V1.md)
3. [API 契约](./API_CONTRACT_V1.md)
4. [实施路线图](./IMPLEMENTATION_ROADMAP_V1.md)
5. [UI 到 API 映射](./UI_API_MAPPING_V1.md)

## 2. 里程碑

## M0 原型冻结（当前优先）

交付物：

- 企业级 Web 控制台低保真原型
- 个人版桌面 Web 视图低保真原型
- 页面信息架构与导航规范
- 关键用户流程图（消息处理、策略审批、会话追踪）

通过标准：

- 团队能基于原型对“入口/流程/权限边界”达成一致
- 明确 MVP 只做哪些页面与功能

## M1 工程骨架

交付物：

- Monorepo 目录与包边界固定
- `protocol`（事件/请求/schema）首版
- `gateway` 最小握手与路由
- `core(pi-wrapper)` 最小 run/continue/abort

通过标准：

- 从一个测试入口可打通 `gateway -> core -> mock response`

## M2 MVP 功能闭环

交付物：

- Slack connector（先单渠道）
- 个人版桌面入口（Tauri）
- 会话存储 + 基础审计
- `bash/file/http` 三类工具

通过标准：

- 能完成一条真实消息链路并回传

## M3 企业增强

交付物：

- 多租户 + RBAC
- 模型/工具/预算策略中心
- 记忆检索（hybrid）与压缩前记忆刷新
- 企业审计导出

## 3. 文件夹规划

```text
apps/
  prototypes/
    enterprise-web/
    personal-desktop-web/
  gateway/
  desktop/
  web-console/
packages/
  protocol/
  core/
  gateway-core/
  channel-connectors/
  tool-executor/
  skill-engine/
  model-adapters/
  storage/
docs/
  IMPLEMENTATION_PATH.md
  UI_SCOPE.md
  BACKEND_ARCHITECTURE_V1.md
  AGENT_DESIGN_V1.md
  API_CONTRACT_V1.md
  IMPLEMENTATION_ROADMAP_V1.md
  UI_API_MAPPING_V1.md
```

## 4. 原型优先开发顺序

1. 企业版：`总览 -> 会话 -> 策略 -> 审计`
2. 个人版：`对话 -> 记忆 -> 工具运行`
3. 统一组件：导航、状态条、事件流视图、消息详情抽屉

## 5. 原型后立即产出的工程资产

原型冻结后，马上补四个技术清单：

1. 页面到 API 的映射表
2. 页面到权限点（RBAC）的映射表
3. 页面到事件流（WS event）的映射表
4. 页面到数据模型（table/schema）的映射表
