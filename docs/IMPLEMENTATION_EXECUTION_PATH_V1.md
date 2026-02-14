# OpenFoal 实施路径（执行版 v1，Local-First）

更新时间：2026-02-13

## 1. 本轮目标

1. 事实对齐：文档与真实实现一致。
2. 契约对齐：API 字段与协议/网关/测试一致。
3. 工程闭环（local）：policy/policy-gate/metrics 从占位到真实仓储与状态机。
4. 记忆 MVP：`memory.get` + `memory.appendDaily` 与会话元数据可观测。
5. SOUL 最小集：引导文件创建与系统提示注入。

## 2. 真实状态（替换过期描述）

1. `apps/gateway` 已有可运行实现（HTTP + WS）。
2. `packages/core/storage/tool-executor/protocol` 均已落地基础能力。
3. `policy.get/update`、`（已移除）/resolve`、`metrics.summary` 已不是占位返回。
4. 会话元数据已包含 `contextUsage/compactionCount/memoryFlushState(/memoryFlushAt)`。
5. 本轮不进入 cloud 交付。

## 3. 迭代顺序（执行优先级）

### Batch A：事实对齐（已完成）

1. 更新实现状态文档，删除“gateway/packages 未实现”等失真描述。
2. 明确本轮边界：仅 local-first，不做 cloud。

### Batch B：契约对齐（已完成）

1. `sessions.get` 字段扩展落地到 storage + gateway + tests。
2. `policy/policy-gate/metrics` 返回结构化真实对象。
3. 协议 Session 类型与 API 文档同步扩展字段。

### Batch C：工程闭环（local）（已完成 MVP）

1. policy repository（SQLite/InMemory）接入。
2. policy-gate repository（SQLite/InMemory）接入并可 resolve。
3. 工具执行前 policy gate（deny/allow/allow）接入。
4. metrics summary 改为真实聚合。

### Batch D：记忆 MVP（已完成）

1. 工具新增：`memory.get`、`memory.appendDaily`。
2. 会话元数据可观测 `memoryFlushState/compactionCount`。
3. pre-compaction memory flush 已接入（`NO_REPLY` 静默写入）。

### Batch E：SOUL 最小集（已完成）

1. `AGENTS.md/SOUL.md/TOOLS.md/USER.md` 缺失自动创建。
2. 不覆盖已有文件。
3. 注入时做长度上限裁剪。
4. 提示词中保持“策略/安全 > persona”的优先级说明。

## 4. 验收口径（当前）

1. 契约可测：网关路由测试覆盖 `sessions.get/policy/policy-gate/metrics`。
2. 持久化可测：policy/policy-gate/session 元数据重启后可恢复。
3. 记忆可测：路径白名单、daily append、读取行为可测。
4. 回归可测：`agent.run`、idempotency、`runtime.setMode(local)` 不退化。

## 5. 暂缓项

1. Cloud runtime、Docker 编排、Postgres/S3。
2. 记忆向量检索（BM25/embedding）。
3. SOUL 高级插件化与 hook 系统。
