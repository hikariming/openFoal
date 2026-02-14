# 记忆 V1 实现清单（Local-First）

更新时间：2026-02-13

## 目标

1. 提供可控、可观测的文件型记忆闭环。  
2. 支持用户在桌面端直接查看与追加记忆。  
3. 保持策略与策略门禁优先，不绕过安全治理。

## 范围

1. `MEMORY.md`（长期记忆）  
2. `memory/YYYY-MM-DD.md`（日记忆）  
3. API：`memory.get`、`memory.appendDaily`  
4. Desktop 设置页“记忆”Tab

## 实现清单

### A. 协议与网关

1. 协议方法增加：
- `memory.get`
- `memory.appendDaily`
2. `memory.appendDaily` 归类为 side-effect，必须带 `idempotencyKey`。
3. 网关路由实现：
- `memory.get` -> 调用工具执行器 `memory.get` 并返回结构化结果
- `memory.appendDaily` -> 调用工具执行器 `memory.appendDaily` 并返回写入结果

验收：
1. 通过 RPC 可读取 `MEMORY.md` 与 `memory/*.md`。  
2. 通过 RPC 可向 daily 记忆追加内容。  
3. 非白名单路径仍返回失败语义。

### B. 工具能力（已有）

1. `memory.get`：按路径+行区间读取（白名单）。  
2. `memory.appendDaily`：写入 daily，可选同步写入 `MEMORY.md`。  
3. pre-compaction flush：上下文接近阈值时静默写入（`NO_REPLY`）。

验收：
1. 工具测试通过，路径越界被拒绝。  
2. 会话元数据可观测 `memoryFlushState/compactionCount`。

### C. Desktop 用户管理入口

1. 设置页增加“记忆”Tab。  
2. 支持选择目标：
- `MEMORY.md`
- `memory/YYYY-MM-DD.md`
3. 支持：
- 刷新读取（可配置行数）
- 追加记忆
- 开关“同时写入 MEMORY.md”
4. 反馈状态：
- loading / success / error

验收：
1. 用户可在设置页读写记忆。  
2. 失败时能看到明确错误信息。  
3. 写入后可立即刷新看到结果。

### D. 测试清单

1. 协议测试：`memory.appendDaily` 幂等键校验。  
2. 网关路由测试：`memory.get`、`memory.appendDaily` 正常返回。  
3. 回归测试：`agent.run`/`policy`/`policy-gate` 不退化。

## 后续 V1.1（非本轮）

1. 记忆条目结构化（facts/tasks/decisions）。  
2. 写入预算与去重规则。  
3. 记忆回顾/清理工作流。  
4. 记忆命中率指标（metrics 补充）。
