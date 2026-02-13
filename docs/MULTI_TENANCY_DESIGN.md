# OpenFoal 多租户设计（演进版）

## 1. 目标

当前 v1 以单租户运行优先，但系统需要从第一天具备“多租户就绪”的设计，避免后续企业化时推倒重来。

本文目标：

1. 明确单租户到多租户的演进路径。
2. 固化需要提前预留的字段、接口和模块边界。
3. 约束迁移方式为“增量迁移”，而非“重构替换”。

## 2. 当前状态与边界

当前约束（v1）：

1. 单租户运行，不启用多租户 RBAC/SSO。
2. 默认租户逻辑常量：`tenant_id = "t_default"`。
3. 先完成 Desktop + WebChat 主链路。

多租户就绪要求（从现在开始执行）：

1. 数据层必须保留 `tenant_id` 字段与索引。
2. API 层必须保留 `tenantId` 语义（即使由服务端默认注入）。
3. 日志、审计、指标必须包含 `tenant_id` 标签。

## 3. 设计原则

1. Single-Tenant Runtime, Multi-Tenant Ready  
   当前运行单租户，代码结构按多租户边界建设。
2. Tenant as First-Class Key  
   `tenant_id` 必须贯穿路由、存储、缓存、审计、指标。
3. Default-Deny Security  
   引入多租户后默认拒绝跨租户访问。
4. Incremental Migration  
   迁移通过新增字段与索引、灰度开关完成，不中断现有链路。

## 4. 分层设计

### 4.1 Gateway 层

1. `TenantResolver`：从 token/session/context 解析 `tenant_id`。
2. `TenantGuard`：所有请求进入业务前做租户边界校验。
3. `TenantRouter`：路由键由 `(tenant, workspace, agent, channel, peer, thread)` 组成。

### 4.2 Policy 层

策略覆盖链：

1. Tenant Policy（租户级）
2. Workspace Policy（工作区级）
3. Agent Policy（Agent 级）

冲突规则：

1. 显式拒绝优先于显式允许。
2. 更细粒度作用域优先（agent > workspace > tenant）。

### 4.3 Storage 层

所有核心表必须包含 `tenant_id`：

1. `workspaces`
2. `agents`
3. `sessions`
4. `messages`
5. `tool_runs`
6. `audit_logs`
7. `approvals`
8. `policies`

建议复合索引：

1. `(tenant_id, workspace_id, updated_at)`
2. `(tenant_id, session_id, created_at)`
3. `(tenant_id, run_id)`
4. `(tenant_id, action, created_at)`

### 4.4 可观测性层

所有 metrics/logs/traces 必须带：

1. `tenant_id`
2. `workspace_id`
3. `agent_id`
4. `run_id`
5. `trace_id`

## 5. API 与类型预留

### 5.1 请求上下文

建议所有服务入口都携带：

```ts
type RequestContext = {
  tenantId: string;
  workspaceId: string;
  actorId: string;
  actorType: "user" | "service";
  traceId: string;
};
```

### 5.2 会话类型

```ts
type Session = {
  id: string;
  tenantId: string;
  workspaceId: string;
  sessionKey: string;
  runtimeMode: "local" | "cloud";
  syncState: "local_only" | "syncing" | "synced" | "conflict";
};
```

### 5.3 协议约束

1. side-effect 方法必须含 `idempotencyKey`。
2. 服务端幂等缓存键至少包含 `(tenantId, method, idempotencyKey)`。

## 6. 权限模型演进（后续开启）

v1 不启用 RBAC/SSO，但提前预留接口：

```ts
interface AuthzProvider {
  can(ctx: RequestContext, action: string, resource: ResourceRef): Promise<boolean>;
}
```

阶段性策略：

1. v1：`AuthzProvider` 默认全放行（同租户）。
2. v1.5：引入角色模型（`owner/admin/developer/viewer/auditor`）。
3. v2：接入 SSO 与组织目录，实现正式 RBAC。

## 7. 数据迁移策略

### 7.1 从单租户到多租户

1. schema 增加 `tenant_id`（可先默认值回填）。
2. 回填历史数据 `tenant_id = "t_default"`。
3. 增加复合索引与唯一约束。
4. 所有查询强制追加 `tenant_id` 条件。
5. 开启 `TenantGuard` 强校验。

### 7.2 回滚策略

1. 保留旧查询路径开关（短窗口）。
2. 遇到租户条件异常时可切回单租户只读模式。
3. 所有迁移脚本必须可重放且幂等。

## 8. 实施分期建议

### Phase A（现在）

1. 落地租户字段与接口预留。
2. 将 `tenant_id` 纳入日志与指标。
3. 保持产品体验仍为单租户。

### Phase B（规模化前）

1. 开启租户管理 API（创建/停用租户）。
2. 开启租户级配额、预算与策略中心。
3. 审计与审批按租户隔离可查询。

### Phase C（企业化）

1. 接入 SSO（OIDC/SAML）。
2. 启用 RBAC 与细粒度资源权限。
3. 支持租户级导出、归档、合规策略。

## 9. 与现有 v1 文档关系

1. Backend 主方案：`BACKEND_ARCHITECTURE_V1.md`
2. Agent 设计：`AGENT_DESIGN_V1.md`
3. 协议契约：`API_CONTRACT_V1.md`
4. 路线图：`IMPLEMENTATION_ROADMAP_V1.md`
5. UI 映射：`UI_API_MAPPING_V1.md`

本文件是“未来扩展约束”，用于确保 v1 的技术决策不阻断多租户升级。
