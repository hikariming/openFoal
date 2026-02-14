# OpenFoal Implementation Roadmap v1

关联文档：

1. [Backend 架构](./BACKEND_ARCHITECTURE_V1.md)
2. [Agent 设计](./AGENT_DESIGN_V1.md)
3. [API 契约](./API_CONTRACT_V1.md)
4. [UI 到 API 映射](./UI_API_MAPPING_V1.md)

## 里程碑 M1-M5

| 里程碑 | 周期 | 核心目标 | Owner 建议 |
|---|---|---|---|
| M1 | 第 1-2 周 | 协议与工程骨架可运行 | Gateway / Protocol / Desktop |
| M2 | 第 3-4 周 | 本地运行闭环（真实 agent + 工具） | Core / Executor / Storage |
| M3 | 第 5-6 周 | 云端沙盒闭环（Docker + 云存储） | Executor / Gateway / Storage |
| M4 | 第 7-8 周 | 控制台绑定与本地优先同步 | WebConsole / Gateway / Storage |
| M5 | 第 9-10 周 | 硬化、可观测、发布准备 | Gateway / Core / DevOps |

## 每阶段交付物

### M1（第 1-2 周）

1. `packages/protocol` 首版 schema 与类型。
2. `apps/gateway` 支持 `connect` + `agent.run(mock)`。
3. `apps/desktop` 接真实 WS client，替代本地 mock 数据主链路。

### M2（第 3-4 周）

1. `packages/core` 接入真实 runtime loop（run/continue/abort）。
2. `packages/tool-executor(local)` 支持 `bash/file/http`。
3. `packages/storage` 本地实现（SQLite + transcript + memory files）。
4. 完成 `sessions.list/get` 最小可用接口。

### M3（第 5-6 周）

1. `packages/tool-executor(cloud)` Docker driver 与容器生命周期。
2. `runtime.setMode` 与会话级 mode 语义落地。
3. 云端 Postgres 与对象存储接入。
4. 策略门禁队列与恢复执行链路（`agent.failed/resolve`）。

### M4（第 7-8 周）

1. `apps/web-console` 绑定 `sessions.list/policy.get/update/audit.query/policy-gate.*`。
2. 本地优先同步（local -> cloud）增量任务落地。
3. 冲突状态 `syncState=conflict` 可见与可恢复。

### M5（第 9-10 周）

1. 鉴权、限流、幂等、防重入与错误分级完善。
2. 指标与 tracing（`trace_id` + `run_id`）贯通。
3. 发布前文档、部署模板、运行手册完善。

## 验收标准

### 全局验收

1. Desktop 可切换本地/云端沙盒并完成真实对话链路。
2. Web Console 关键页面由真实 API 驱动，不依赖硬编码数据。
3. 策略变更、工具执行与策略门禁流程可审计可回放。
4. 同步失败与冲突可观测、可重试、可解释。

### 阶段验收（DoD）

1. M1：`agent.run` 有可消费的流式事件。
2. M2：本地工具 loop 可执行并持久化。
3. M3：云端 Docker 执行稳定，策略门禁可拦截高风险调用。
4. M4：控制台可改策略、看审计、做策略门禁。
5. M5：回归用例通过，发布阻塞问题清零。

## 测试与验收场景

1. 协议测试：schema 校验、错误码一致性、向后兼容字段。
2. 会话测试：session key 规范化、`/new /reset /compact`、mode 切换时序。
3. 执行测试：local executor 与 cloud docker executor 的成功/失败/超时路径。
4. 策略门禁测试：高风险调用拦截、策略门禁通过恢复、拒绝终止。
5. 同步测试：离线增量上云、幂等重放、冲突标记。
6. 安全测试：未授权 connect 拒绝、越权 session 拒绝、网络白名单有效。
7. 可观测性测试：`trace_id/run_id` 可串联 message/tool/audit 全链路。

## 风险与缓解

1. 风险：本地/云语义混淆。
   - 缓解：会话级 `runtimeMode`，运行中切换排队，UI 显式展示。
2. 风险：云端容器资源成本过高。
   - 缓解：会话 TTL 回收、并发上限、预算熔断。
3. 风险：同步冲突造成体验割裂。
   - 缓解：本地主权 + 云端 append-only + 冲突显式状态。
4. 风险：范围膨胀（过早接多渠道）。
   - 缓解：v1 固定 Desktop + WebChat，连接器后置。

## 回滚策略

1. 协议回滚：保留前一版本 schema，网关支持双版本窗口。
2. 模式回滚：`runtime.setMode` 支持强制切回 `local`。
3. 执行回滚：cloud executor 异常时，策略降级为本地执行或只读模式。
4. 存储回滚：同步任务可暂停，云写入改为只读镜像，不影响本地主链路。
5. 发布回滚：按里程碑版本 tag 回滚 gateway/core/executor 三件套。

## 假设与默认值

1. v1 不做多租户 RBAC，不做 SSO。
2. v1 不做 Slack/Telegram 首发接入，先 Desktop+WebChat。
3. 云隔离采用 Docker，不上 microVM。
4. 本地数据主权优先，云为可选增强。
5. 产品维持开源定位，不引入订阅升级流程。
