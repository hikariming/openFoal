> [!WARNING]
> ARCHIVED (2026-02-14): This document is kept for historical reference only.
> Active source of truth: `/Users/rqq/openFoal/docs/PRODUCT_TRUTH.md`.
> Do not use this file for planning or implementation.

# OpenFoal Backend 测试策略 v1

## 1. 目标

在实现后端功能前，先固定测试入口与验收标准，避免“功能做完才补测试”。

本策略覆盖：

1. 协议层（Protocol）
2. 网关路由层（Gateway）
3. 会话与模式状态层（Session + runtimeMode）
4. 幂等与错误码一致性

## 2. 测试分层

### L1: Contract Tests（必须先有）

目的：确保 `req/res/event`、方法名、错误码、side-effect 幂等约束稳定。

覆盖点：

1. `agent.run` 缺失 `idempotencyKey` 必须失败。
2. 未知方法返回 `METHOD_NOT_FOUND`。
3. 未 `connect` 前调用其他方法返回 `UNAUTHORIZED`。
4. 同幂等键同参数返回首结果；同键不同参数返回 `IDEMPOTENCY_CONFLICT`。

### L2: Router Integration Tests（M1 必做）

目的：验证网关路由闭环（不依赖真实模型）。

覆盖点：

1. `connect -> sessions.list` 正常。
2. `agent.run(mock)` 输出 `agent.accepted/delta/completed`。
3. `runtime.setMode` 在 `running` 时返回 `queued-change`。
4. `runtime.setMode` 在 `idle` 时立即生效并发 `runtime.mode_changed`。

### L3: Executor/Storage Tests（M2 开始）

目的：验证本地执行与持久化链路。

覆盖点：

1. `bash/file/http` 成功/失败/超时。
2. transcript 与 session 元数据写入一致。
3. `/new /reset /compact` 对会话状态的影响。

## 3. 验收门禁

M1 起执行以下 gate：

1. 合同测试 100% 通过。
2. 关键错误码断言通过（`UNAUTHORIZED`、`INVALID_REQUEST`、`METHOD_NOT_FOUND`、`IDEMPOTENCY_CONFLICT`）。
3. 每次新增 side-effect 方法必须补幂等测试。

## 4. 执行命令

在仓库根目录运行：

```bash
npm run test:backend
```

该命令会先构建后端包，再运行 `tests/backend/*.test.mjs`。

仅构建：

```bash
npm run build:backend
```

## 5. 与实施路径的关系

推荐实施顺序：

1. 先做 `packages/protocol` + `apps/gateway` 可测闭环。
2. 再接入 `packages/core` 真实 runtime。
3. 再接入 `packages/tool-executor` 与 `packages/storage` 实现。

结论：不是先写“复杂核心模块”，而是先把协议和网关闭环做成可测地基，再逐层替换 mock。
