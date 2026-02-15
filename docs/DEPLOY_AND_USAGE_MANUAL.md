# OpenFoal 部署与使用说明书（Docker 优先）

更新时间：2026-02-14  
状态：ACTIVE

## 1. 选择版本

1. 个人版（完全不用企业能力）：`gateway + personal-web`
2. 商业版（Enterprise Control）：`gateway + web-console + docker-runner + bootstrap`

## 2. 前置条件

1. Docker + Docker Compose 可用。
2. 端口未占用：
   - `8787`（gateway）
   - `5180`（personal-web）
   - `5173`（web-console）
3. 命令行验证若使用 `jq` 解析 token，请先安装 `jq`。

## 3. 个人版（完全不用企业）

启动：

```bash
cd /Users/rqq/openFoal
npm run up:personal
```

访问：

1. 个人 Web：`http://127.0.0.1:5180`
2. 网关健康：`http://127.0.0.1:8787/health`

说明：

1. 个人版已移除 `mock` 回复模式，不再提供本地回显型回答。
2. 未配置可用模型 API Key 时，运行会返回 `MODEL_UNAVAILABLE`。

常用命令：

```bash
npm run logs:personal
npm run ps:docker
npm run down:personal
```

## 4. 商业版（从零到首条 run）

### 4.1 启动

```bash
cd /Users/rqq/openFoal
npm run up:enterprise
```

默认认证模式：

1. `OPENFOAL_AUTH_MODE=hybrid`
2. `OPENFOAL_ENTERPRISE_REQUIRE_AUTH=true`
3. 默认本地管理员：`tenant=default` / `username=admin` / `password=admin123!`

启动后会自动执行 `bootstrap-enterprise`，写入默认：

1. `tenantId=t_default`
2. `workspaceId=w_default`
3. `agentId=a_default`
4. `executionTargetId=target_enterprise_docker`（指向内部 `docker-runner`）

访问：

1. 企业控制台：`http://127.0.0.1:5173`
2. 网关健康：`http://127.0.0.1:8787/health`

### 4.2 验证 bootstrap 是否成功

```bash
npm run logs:enterprise
```

看到类似日志即成功：

```text
[bootstrap-enterprise] done: tenant=t_default workspace=w_default agent=a_default target=target_enterprise_docker
```

### 4.3 获取 access token（企业默认必需）

```bash
ACCESS_TOKEN=$(curl -sS "http://127.0.0.1:8787/auth/login" \
  -H "content-type: application/json" \
  -d '{
    "tenant":"default",
    "username":"admin",
    "password":"admin123!"
  }' | jq -r '.access_token')
```

```bash
test -n "$ACCESS_TOKEN" && echo "login ok"
```

### 4.4 发送首条企业 run（RPC）

```bash
curl -sS "http://127.0.0.1:8787/rpc?connectionId=enterprise_manual" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${ACCESS_TOKEN}" \
  -d '{
    "type":"req",
    "id":"r_connect",
    "method":"connect",
    "params":{
      "auth":{
        "type":"Bearer",
        "token":"'"${ACCESS_TOKEN}"'"
      }
    }
  }'
```

```bash
curl -sS "http://127.0.0.1:8787/rpc?connectionId=enterprise_manual" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${ACCESS_TOKEN}" \
  -d '{
    "type":"req",
    "id":"r_run_1",
    "method":"agent.run",
    "params":{
      "idempotencyKey":"idem_enterprise_manual_run_1",
      "sessionId":"s_enterprise_manual",
      "input":"run [[tool:bash.exec {\"cmd\":\"printf hello-enterprise\"}]]",
      "runtimeMode":"local",
      "tenantId":"t_default",
      "workspaceId":"w_default",
      "agentId":"a_default",
      "actor":"enterprise-admin"
    }
  }'
```

成功标志：

1. 返回 `response.ok=true` 且包含 `runId`
2. 事件里出现 `agent.tool_result`

### 4.5 审计筛选 + 分页验证

第一页：

```bash
curl -sS "http://127.0.0.1:8787/rpc?connectionId=enterprise_manual" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${ACCESS_TOKEN}" \
  -d '{
    "type":"req",
    "id":"r_audit_1",
    "method":"audit.query",
    "params":{
      "tenantId":"t_default",
      "workspaceId":"w_default",
      "action":"agent.run.completed",
      "limit":1
    }
  }'
```

第二页（带 `cursor`）：

```bash
curl -sS "http://127.0.0.1:8787/rpc?connectionId=enterprise_manual" \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${ACCESS_TOKEN}" \
  -d '{
    "type":"req",
    "id":"r_audit_2",
    "method":"audit.query",
    "params":{
      "tenantId":"t_default",
      "workspaceId":"w_default",
      "action":"agent.run.completed",
      "limit":1,
      "cursor":123
    }
  }'
```

### 4.6 停止商业版

```bash
npm run down:enterprise
```

## 5. 自动化验证

### 5.1 全局基础回归

1. `npm run test:backend`
2. `npm run test:auth`（触达 enterprise auth/tenant 代码时必跑）

### 5.2 个人版测试（Personal）

1. 自动化：`npm run test:p1:smoke`
2. Docker 验收：
   - `npm run up:personal`
   - 打开 `http://127.0.0.1:5180` 完成一轮问答
   - `npm run logs:personal`
   - `npm run down:personal`

### 5.3 企业版测试（Enterprise）

1. 非 Docker 场景联调：`npm run test:p2:e2e`
2. Docker 场景联调：`npm run test:p2:e2e:docker`
3. 企业认证最小验收：
   - `/auth/login` 可拿到 `access_token`
   - `connect` 可携带 token 成功
   - 无 token 时返回 `AUTH_REQUIRED`

## 6. 常见问题

1. `connect 之前不能调用其他方法`：先调用 `connect`。
2. `AUTH_REQUIRED`：企业模式默认要求先登录并在 `connect.params.auth.token` 传 token。
3. `FORBIDDEN`：当前角色无治理写权限（`member` 默认不可更新 budget/policy/agents/targets）。
4. `TENANT_SCOPE_MISMATCH` / `WORKSPACE_SCOPE_MISMATCH`：请求作用域与 token 不一致。
5. `POLICY_DENIED`：策略拒绝；检查 `policy.update` 与 `budget.update`。
6. `docker-runner 缺少 endpoint`：检查 `bootstrap-enterprise` 是否成功。
7. `sqlite3` 找不到：检查 gateway 镜像是否正确构建（镜像内已安装 sqlite3 CLI）。
8. 审计为空：确认 `tenantId/workspaceId/action` 过滤条件是否过严。
