# P2 Docker Runner HTTP Protocol（固定版）

更新时间：2026-02-14  
状态：ACTIVE（P2 执行面协议基线）

## 1. 目标

定义 Gateway 与 `docker-runner` 之间的稳定 HTTP 合同，避免执行链路在多实现下产生歧义。

## 2. 端点与方法

1. Gateway 从 `execution_targets.endpoint` 读取目标地址。  
2. Gateway 对该地址发起 `POST`。  
3. 请求头：
   - `content-type: application/json`
   - 若配置了 `execution_targets.auth_token`，额外带 `authorization: Bearer <token>`

## 3. 请求 Schema

```json
{
  "call": {
    "name": "bash.exec",
    "args": {
      "cmd": "printf hello"
    }
  },
  "ctx": {
    "runId": "run_xxx",
    "sessionId": "s_xxx",
    "runtimeMode": "local",
    "toolCallId": "tool_xxx"
  },
  "target": {
    "targetId": "target_remote_runner",
    "kind": "docker-runner",
    "tenantId": "t_default",
    "workspaceId": "w_default"
  }
}
```

字段要求：

1. `call.name`：必填，工具名。
2. `call.args`：必填，对象。
3. `ctx.runId/sessionId/runtimeMode`：必填，用于链路追踪与隔离。
4. `target.*`：必填，执行目标快照。

## 4. 响应 Schema（支持两种）

### 4.1 直接 ToolResult

```json
{
  "ok": true,
  "output": "..."
}
```

或

```json
{
  "ok": false,
  "error": {
    "code": "TOOL_EXEC_FAILED",
    "message": "..."
  }
}
```

### 4.2 带 updates 的包裹格式

```json
{
  "updates": [
    { "delta": "step-1", "at": "2026-02-14T12:00:00.000Z" }
  ],
  "result": {
    "ok": true,
    "output": "..."
  }
}
```

说明：

1. `updates` 可选；Gateway 会转发为工具流式更新。
2. `result` 必须满足 ToolResult 结构。

## 5. 状态码约定

1. `2xx`：Gateway 解析响应 JSON 并继续按 ToolResult 处理。  
2. 非 `2xx`：Gateway 视为执行失败，返回 `TOOL_EXEC_FAILED`。  
3. 响应体非 JSON 或结构不匹配：Gateway 返回 `TOOL_EXEC_FAILED`。

## 6. 错误码约定（Gateway 对外）

`docker-runner` 相关失败统一映射为：

1. `TOOL_EXEC_FAILED`：
   - 连接失败
   - 超时
   - 非 2xx
   - 非 JSON
   - 响应结构不匹配
   - 目标缺少 endpoint

注意：`POLICY_DENIED` 等策略错误由 Gateway 策略层产生，不由 runner 直接返回。

## 7. 超时约定

1. 默认超时：`15000ms`。
2. 可通过 `execution_targets.config.timeoutMs` 覆盖。
3. 上限：`180000ms`（Gateway 会截断过大值）。
4. 超时后该次工具调用失败，返回 `TOOL_EXEC_FAILED`。

## 8. 最小 Mock Runner 参考

```bash
curl -X POST http://127.0.0.1:18081/execute \
  -H 'content-type: application/json' \
  -d '{"call":{"name":"bash.exec","args":{"cmd":"printf ok"}},"ctx":{"runId":"r","sessionId":"s","runtimeMode":"local"},"target":{"targetId":"t","kind":"docker-runner","tenantId":"tenant"}}'
```

Mock 返回：

```json
{
  "result": {
    "ok": true,
    "output": "mock-runner:bash.exec"
  }
}
```

## 9. 联调入口

使用脚本：

1. `npm run test:p2:e2e`
2. 该脚本会启动 `mock docker-runner + gateway + web-console`，并验证：
   - docker-runner 远程执行命中
   - `audit.query` 筛选与分页链路可用
