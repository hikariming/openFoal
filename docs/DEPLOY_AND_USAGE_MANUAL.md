# OpenFoal 从零部署与使用说明书

更新时间：2026-02-14  
状态：ACTIVE

## 1. 你该选哪条路径

1. 只想个人使用（完全不用企业能力）：走 **路径 A（Personal Runtime/Access）**。  
2. 需要企业治理（预算/审计/策略/执行目标）：走 **路径 B（Enterprise Control）**。

## 2. 通用前置条件

1. Node.js 建议 `>=18`（推荐 20/22）。
2. 在项目根目录执行依赖安装：

```bash
cd /Users/rqq/openFoal
npm install
```

3. 默认网关地址：`http://127.0.0.1:8787`

## 3. 路径 A：个人版（完全不用企业）

目标：本机单用户，直接聊天，不启用企业控制台，不配置租户治理。

### 3.1 启动服务

终端 1（网关）：

```bash
cd /Users/rqq/openFoal
npm run dev:gateway
```

终端 2（二选一）：

1. 个人 Web：

```bash
cd /Users/rqq/openFoal
npm run dev:personal-web
```

2. 桌面端：

```bash
cd /Users/rqq/openFoal
npm run dev:desktop
```

### 3.2 首次使用

1. 打开个人 Web 或桌面端。  
2. 新建/选择会话。  
3. 直接发送消息。  
4. 刷新后会话历史可通过 `sessions.history` 回放（已实现）。

### 3.3 个人版常用验证命令

```bash
cd /Users/rqq/openFoal
npm run test:backend
npm run test:p1:smoke
```

## 4. 路径 B：企业版（从零到首条 run）

目标：启用企业控制面 + 执行目标治理，并跑通首条企业 `agent.run`。

### 4.1 启动网关与控制台

终端 1（网关）：

```bash
cd /Users/rqq/openFoal
npm run dev:gateway
```

终端 2（企业控制台）：

```bash
cd /Users/rqq/openFoal
npm run dev:web
```

打开控制台地址（Vite 输出的本地地址，通常是 `http://127.0.0.1:5173`）。

### 4.2 准备一个 docker-runner（最小 mock）

终端 3（mock runner）：

```bash
node -e "const {createServer}=require('node:http');createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const body=JSON.parse(raw||'{}');const toolName=body?.call?.name||'unknown';res.setHeader('content-type','application/json');res.end(JSON.stringify({updates:[{delta:'runner:'+toolName,at:new Date().toISOString()}],result:{ok:true,output:'mock-runner:'+toolName}}));});}).listen(18081,'127.0.0.1',()=>console.log('mock runner on http://127.0.0.1:18081/execute'));"
```

### 4.3 通过 RPC 完成企业初始化

#### Step 1) connect

```bash
curl -sS "http://127.0.0.1:8787/rpc?connectionId=ent_bootstrap" \
  -H "content-type: application/json" \
  -d '{"type":"req","id":"r_connect","method":"connect","params":{}}'
```

#### Step 2) 注册执行目标（docker-runner）

```bash
curl -sS "http://127.0.0.1:8787/rpc?connectionId=ent_bootstrap" \
  -H "content-type: application/json" \
  -d '{
    "type":"req",
    "id":"r_target",
    "method":"executionTargets.upsert",
    "params":{
      "idempotencyKey":"idem_target_1",
      "tenantId":"t_demo",
      "workspaceId":"w_demo",
      "targetId":"target_demo_docker",
      "kind":"docker-runner",
      "endpoint":"http://127.0.0.1:18081/execute",
      "authToken":"runner-demo-token",
      "isDefault":true,
      "enabled":true,
      "config":{"timeoutMs":10000}
    }
  }'
```

#### Step 3) 注册 agent_definition 并绑定 target

```bash
curl -sS "http://127.0.0.1:8787/rpc?connectionId=ent_bootstrap" \
  -H "content-type: application/json" \
  -d '{
    "type":"req",
    "id":"r_agent",
    "method":"agents.upsert",
    "params":{
      "idempotencyKey":"idem_agent_1",
      "tenantId":"t_demo",
      "workspaceId":"w_demo",
      "agentId":"a_demo",
      "name":"Demo Agent",
      "runtimeMode":"local",
      "executionTargetId":"target_demo_docker",
      "enabled":true
    }
  }'
```

#### Step 4) 发起首条企业 run

```bash
curl -sS "http://127.0.0.1:8787/rpc?connectionId=ent_bootstrap" \
  -H "content-type: application/json" \
  -d '{
    "type":"req",
    "id":"r_run_1",
    "method":"agent.run",
    "params":{
      "idempotencyKey":"idem_run_1",
      "sessionId":"s_demo",
      "input":"run [[tool:bash.exec {\"cmd\":\"printf hello-enterprise\"}]]",
      "runtimeMode":"local",
      "tenantId":"t_demo",
      "workspaceId":"w_demo",
      "agentId":"a_demo",
      "actor":"admin-demo"
    }
  }'
```

成功标志：

1. `response.ok = true` 且返回 `runId`。  
2. 事件中可见 `agent.tool_result`，输出包含 `mock-runner:bash.exec`（表示已命中远程 runner）。

#### Step 5) 审计筛选 + 分页验证

第一页：

```bash
curl -sS "http://127.0.0.1:8787/rpc?connectionId=ent_bootstrap" \
  -H "content-type: application/json" \
  -d '{
    "type":"req",
    "id":"r_audit_1",
    "method":"audit.query",
    "params":{
      "tenantId":"t_demo",
      "workspaceId":"w_demo",
      "action":"agent.run.completed",
      "limit":1
    }
  }'
```

第二页（把上一页 `nextCursor` 填入 `cursor`）：

```bash
curl -sS "http://127.0.0.1:8787/rpc?connectionId=ent_bootstrap" \
  -H "content-type: application/json" \
  -d '{
    "type":"req",
    "id":"r_audit_2",
    "method":"audit.query",
    "params":{
      "tenantId":"t_demo",
      "workspaceId":"w_demo",
      "action":"agent.run.completed",
      "limit":1,
      "cursor":123
    }
  }'
```

### 4.4 企业版一键联调（推荐）

已内置完整联调脚本（mock runner + gateway + web-console + 审计分页校验）：

```bash
cd /Users/rqq/openFoal
npm run test:p2:e2e
```

## 5. 常见问题

1. `connect 之前不能调用其他方法`：先调用 `connect`。  
2. `POLICY_DENIED`：策略拒绝（默认仅高风险工具允许，非高风险工具可能被 `toolDefault=deny` 拒绝）。  
3. `docker-runner 缺少 endpoint`：`executionTargets.upsert` 必须提供 `endpoint`。  
4. Web 控制台启动失败且报 `crypto.getRandomValues`：请使用 Node `>=18`。  
5. 预算超限被拒绝：检查 `budget.get/update` 与审计 `budget.rejected` 记录。

## 6. 关键文档

1. 产品真相：`/Users/rqq/openFoal/docs/PRODUCT_TRUTH.md`
2. P2 协议：`/Users/rqq/openFoal/docs/testing/P2_DOCKER_RUNNER_HTTP_PROTOCOL.md`
3. P2 测试计划：`/Users/rqq/openFoal/docs/testing/P2_ENTERPRISE_CONTROL_TEST_PLAN.md`
