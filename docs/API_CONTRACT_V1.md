# OpenFoal API Contract v1

关联文档：

1. [Backend 架构](./BACKEND_ARCHITECTURE_V1.md)
2. [Agent 设计](./AGENT_DESIGN_V1.md)
3. [实施路线图](./IMPLEMENTATION_ROADMAP_V1.md)
4. [UI 到 API 映射](./UI_API_MAPPING_V1.md)

## WS 帧结构

所有实时协议统一为 `req/res/event` 三类帧：

```json
{
  "type": "req",
  "id": "r_001",
  "method": "agent.run",
  "params": {}
}
```

```json
{
  "type": "res",
  "id": "r_001",
  "ok": true,
  "payload": {}
}
```

```json
{
  "type": "event",
  "event": "agent.delta",
  "payload": {},
  "seq": 120,
  "stateVersion": 42
}
```

规范：

1. 首帧必须为 `connect`。
2. 所有 side-effect 方法必须携带 `idempotencyKey`。
3. `id` 由客户端生成并在 `res` 中原样回传。

## 方法列表

| 方法 | 作用 | 是否 side-effect | 是否要求 `idempotencyKey` |
|---|---|---|---|
| `connect` | 建立连接并握手鉴权 | 否 | 否 |
| `agent.run` | 发起一次 agent 运行 | 是 | 是 |
| `agent.abort` | 中止运行中的 run | 是 | 是 |
| `runtime.setMode` | 设置会话运行模式 | 是 | 是 |
| `sessions.list` | 会话列表查询 | 否 | 否 |
| `sessions.get` | 会话详情查询 | 否 | 否 |
| `policy.get` | 读取策略 | 否 | 否 |
| `policy.update` | 更新策略 | 是 | 是 |
| `approval.queue` | 查询待审批队列 | 否 | 否 |
| `approval.resolve` | 审批通过/拒绝 | 是 | 是 |
| `audit.query` | 审计检索 | 否 | 否 |
| `metrics.summary` | 指标汇总（预留） | 否 | 否 |

## 事件列表

固定事件：

1. `agent.accepted`
2. `agent.delta`
3. `agent.tool_call`
4. `agent.tool_result`
5. `agent.completed`
6. `agent.failed`
7. `runtime.mode_changed`
8. `session.updated`
9. `approval.required`
10. `approval.resolved`

## 错误码

| 错误码 | 含义 | 建议处理 |
|---|---|---|
| `UNAUTHORIZED` | 鉴权失败 | 终止连接，提示重新登录/配置 token |
| `INVALID_REQUEST` | schema 校验失败 | 客户端修正参数后重试 |
| `METHOD_NOT_FOUND` | 方法不存在 | 升级客户端或检查 method 拼写 |
| `IDEMPOTENCY_CONFLICT` | 幂等键冲突且参数不一致 | 生成新幂等键重试 |
| `SESSION_BUSY` | 会话已被占用 | 排队或提示稍后重试 |
| `POLICY_DENIED` | 策略拒绝执行 | 在 UI 展示具体策略原因 |
| `APPROVAL_REQUIRED` | 工具调用需要审批 | 引导去审批中心处理 |
| `MODEL_UNAVAILABLE` | 模型与 fallback 全部不可用 | 切换模型或稍后重试 |
| `TOOL_EXEC_FAILED` | 工具执行失败 | 按错误内容做重试或降级 |
| `INTERNAL_ERROR` | 未分类内部错误 | 记录 trace_id 并告警 |

## 幂等策略

### 必须携带 `idempotencyKey` 的方法

1. `agent.run`
2. `agent.abort`
3. `runtime.setMode`
4. `policy.update`
5. `approval.resolve`

### 服务端行为

1. 同一 `method + idempotencyKey + actor + sessionId` 且参数相同：返回首次结果。
2. 若同 key 但参数不同：返回 `IDEMPOTENCY_CONFLICT`。
3. 幂等记录至少保留 24 小时。

## 鉴权握手

握手流程：

1. 客户端建立 WS 连接。
2. 发送 `connect` 请求（含 token 或会话凭据）。
3. 服务端返回 `connect` 响应与初始快照（可选）。
4. 成功后可发送其他方法；失败则服务端关闭连接。

建议 `connect.params`：

```json
{
  "client": {
    "name": "desktop",
    "version": "0.1.0"
  },
  "auth": {
    "token": "xxxxx"
  },
  "workspaceId": "w_default"
}
```

## 版本兼容策略

1. 协议版本采用 semver，版本号写入 `connect.payload.protocolVersion`。
2. 新增字段必须后向兼容，不可破坏旧字段语义。
3. 删除字段必须先经历一个 deprecation 周期。
4. 客户端应忽略未知字段，服务端应容忍可忽略扩展字段。

## Public APIs / Interfaces / Types 变化

### Session 扩展

```ts
type Session = {
  id: string;
  sessionKey: string;
  runtimeMode: "local" | "cloud";
  syncState: "local_only" | "syncing" | "synced" | "conflict";
};
```

### CoreService 统一接口

```ts
interface CoreService {
  run(input: CoreRunInput): AsyncIterable<CoreEvent>;
  continue(input: CoreContinueInput): AsyncIterable<CoreEvent>;
  abort(runId: string): Promise<void>;
}
```

### ToolExecutor 统一接口

```ts
interface ToolExecutor {
  execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult>;
}
```

## JSON 示例（关键方法至少 1 组）

### 1) `connect`

```json
{
  "type": "req",
  "id": "r_connect_1",
  "method": "connect",
  "params": {
    "client": { "name": "desktop", "version": "0.1.0" },
    "auth": { "token": "token_abc" },
    "workspaceId": "w_default"
  }
}
```

```json
{
  "type": "res",
  "id": "r_connect_1",
  "ok": true,
  "payload": {
    "protocolVersion": "1.0.0",
    "serverTime": "2026-02-13T12:00:00Z"
  }
}
```

### 2) `agent.run`

```json
{
  "type": "req",
  "id": "r_run_1",
  "method": "agent.run",
  "params": {
    "idempotencyKey": "idem_run_20260213_001",
    "sessionId": "s_001",
    "input": "总结今天待办并写入记忆",
    "runtimeMode": "local"
  }
}
```

```json
{
  "type": "res",
  "id": "r_run_1",
  "ok": true,
  "payload": {
    "runId": "run_001",
    "status": "accepted"
  }
}
```

### 3) `agent.abort`

```json
{
  "type": "req",
  "id": "r_abort_1",
  "method": "agent.abort",
  "params": {
    "idempotencyKey": "idem_abort_20260213_001",
    "runId": "run_001"
  }
}
```

```json
{
  "type": "res",
  "id": "r_abort_1",
  "ok": true,
  "payload": {
    "runId": "run_001",
    "status": "aborted"
  }
}
```

### 4) `runtime.setMode`

```json
{
  "type": "req",
  "id": "r_mode_1",
  "method": "runtime.setMode",
  "params": {
    "idempotencyKey": "idem_mode_20260213_001",
    "sessionId": "s_001",
    "runtimeMode": "cloud"
  }
}
```

```json
{
  "type": "res",
  "id": "r_mode_1",
  "ok": true,
  "payload": {
    "sessionId": "s_001",
    "runtimeMode": "cloud",
    "effectiveAt": "next_turn"
  }
}
```

### 5) `sessions.list`

```json
{
  "type": "req",
  "id": "r_sessions_list_1",
  "method": "sessions.list",
  "params": {
    "workspaceId": "w_default",
    "limit": 20
  }
}
```

```json
{
  "type": "res",
  "id": "r_sessions_list_1",
  "ok": true,
  "payload": {
    "items": [
      {
        "id": "s_001",
        "title": "new-desktop",
        "runtimeMode": "local",
        "syncState": "local_only",
        "updatedAt": "2026-02-13T11:52:00Z"
      }
    ]
  }
}
```

### 6) `sessions.get`

```json
{
  "type": "req",
  "id": "r_sessions_get_1",
  "method": "sessions.get",
  "params": {
    "sessionId": "s_001"
  }
}
```

```json
{
  "type": "res",
  "id": "r_sessions_get_1",
  "ok": true,
  "payload": {
    "id": "s_001",
    "runtimeMode": "local",
    "syncState": "local_only",
    "contextUsage": 0.68,
    "compactionCount": 2
  }
}
```

### 7) `policy.get`

```json
{
  "type": "req",
  "id": "r_policy_get_1",
  "method": "policy.get",
  "params": {
    "workspaceId": "w_default",
    "agentId": "main"
  }
}
```

```json
{
  "type": "res",
  "id": "r_policy_get_1",
  "ok": true,
  "payload": {
    "toolPolicy": {
      "defaultAction": "deny",
      "bash.exec": "approval-required"
    },
    "modelPolicy": {
      "primary": "anthropic/claude-sonnet-4-5",
      "fallbacks": ["openai/gpt-5.1"]
    }
  }
}
```

### 8) `policy.update`

```json
{
  "type": "req",
  "id": "r_policy_update_1",
  "method": "policy.update",
  "params": {
    "idempotencyKey": "idem_policy_20260213_001",
    "workspaceId": "w_default",
    "agentId": "main",
    "patch": {
      "toolPolicy": {
        "http.request": "allow"
      }
    }
  }
}
```

```json
{
  "type": "res",
  "id": "r_policy_update_1",
  "ok": true,
  "payload": {
    "version": 8,
    "updatedAt": "2026-02-13T12:05:00Z"
  }
}
```

### 9) `approval.queue`

```json
{
  "type": "req",
  "id": "r_approval_queue_1",
  "method": "approval.queue",
  "params": {
    "workspaceId": "w_default",
    "status": "pending"
  }
}
```

```json
{
  "type": "res",
  "id": "r_approval_queue_1",
  "ok": true,
  "payload": {
    "items": [
      {
        "approvalId": "ap_001",
        "toolName": "bash.exec",
        "status": "pending",
        "runId": "run_001"
      }
    ]
  }
}
```

### 10) `approval.resolve`

```json
{
  "type": "req",
  "id": "r_approval_resolve_1",
  "method": "approval.resolve",
  "params": {
    "idempotencyKey": "idem_approval_20260213_001",
    "approvalId": "ap_001",
    "decision": "approve",
    "comment": "owner approved"
  }
}
```

```json
{
  "type": "res",
  "id": "r_approval_resolve_1",
  "ok": true,
  "payload": {
    "approvalId": "ap_001",
    "status": "approved"
  }
}
```

### 11) `audit.query`

```json
{
  "type": "req",
  "id": "r_audit_query_1",
  "method": "audit.query",
  "params": {
    "workspaceId": "w_default",
    "from": "2026-02-13T00:00:00Z",
    "to": "2026-02-13T23:59:59Z",
    "limit": 50
  }
}
```

```json
{
  "type": "res",
  "id": "r_audit_query_1",
  "ok": true,
  "payload": {
    "items": [
      {
        "id": "audit_001",
        "action": "policy.update",
        "actor": "admin@workspace",
        "createdAt": "2026-02-13T12:05:01Z"
      }
    ]
  }
}
```
