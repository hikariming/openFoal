import { spawn, spawnSync } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const rootDir = resolve(__dirname, "..");
const polyfillPath = resolve(rootDir, "scripts/node-webapi-polyfill.cjs");
const require = createRequire(import.meta.url);

require("./node-webapi-polyfill.cjs");

const cleanupTasks = [];

main().catch(async (error) => {
  console.error(`[p2-e2e] FAILED: ${toErrorMessage(error)}`);
  await cleanupAll();
  process.exit(1);
});

async function main() {
  buildBackend();

  const tempDir = mkdtempSync(join(tmpdir(), "openfoal-p2-e2e-"));
  cleanupTasks.push(async () => {
    rmSync(tempDir, { recursive: true, force: true });
  });
  const sqlitePath = join(tempDir, "gateway.sqlite");

  const runner = await startMockDockerRunner();
  cleanupTasks.push(async () => {
    await closeServer(runner.server);
  });

  const { startGatewayServer } = await import("../apps/gateway/dist/index.js");
  const gateway = await startGatewayServer({
    host: "127.0.0.1",
    port: 0,
    sqlitePath
  });
  cleanupTasks.push(async () => {
    await gateway.close();
  });

  const webConsole = await startWebConsole(gateway.port);
  cleanupTasks.push(async () => {
    await stopProcess(webConsole.process);
  });

  const webRoot = await httpJson({
    method: "GET",
    port: webConsole.port,
    path: "/"
  });
  assert(webRoot.statusCode === 200, `web-console 启动失败, status=${String(webRoot.statusCode)}`);
  assert(String(webRoot.text).includes("OpenFoal Web Console"), "web-console 首页不符合预期");

  const connectionId = `p2_e2e_${Date.now().toString(36)}`;
  await rpcExpectOk(gateway.port, connectionId, "r_connect", "connect", {});

  await rpcExpectOk(gateway.port, connectionId, "r_target_upsert", "executionTargets.upsert", {
    idempotencyKey: "idem_p2_e2e_target_1",
    tenantId: "t_e2e",
    workspaceId: "w_e2e",
    targetId: "target_e2e_docker",
    kind: "docker-runner",
    endpoint: runner.endpoint,
    authToken: "runner-token-e2e",
    isDefault: true,
    enabled: true,
    config: {
      timeoutMs: 10000
    }
  });

  await rpcExpectOk(gateway.port, connectionId, "r_agent_upsert", "agents.upsert", {
    idempotencyKey: "idem_p2_e2e_agent_1",
    tenantId: "t_e2e",
    workspaceId: "w_e2e",
    agentId: "a_e2e",
    name: "P2 E2E Agent",
    runtimeMode: "local",
    executionTargetId: "target_e2e_docker",
    enabled: true
  });

  await rpcExpectOk(gateway.port, connectionId, "r_policy_upsert", "policy.update", {
    idempotencyKey: "idem_p2_e2e_policy_1",
    scopeKey: "default",
    patch: {
      highRisk: "allow"
    },
    tenantId: "t_e2e",
    workspaceId: "w_e2e",
    actor: "e2e-script"
  });

  const runResults = [];
  for (let i = 1; i <= 3; i += 1) {
    const run = await rpcExpectOk(gateway.port, connectionId, `r_run_${i}`, "agent.run", {
      idempotencyKey: `idem_p2_e2e_run_${i}`,
      sessionId: "s_e2e",
      input: "run [[tool:bash.exec {\"cmd\":\"printf hello\"}]]",
      runtimeMode: "local",
      tenantId: "t_e2e",
      workspaceId: "w_e2e",
      agentId: "a_e2e",
      actor: "e2e-user"
    });
    runResults.push(run);
  }

  assert(runner.calls.length >= 3, `docker-runner 未命中，calls=${String(runner.calls.length)}`);
  assert(
    runner.calls.every((item) => item.authorization === "Bearer runner-token-e2e"),
    "docker-runner 授权头不正确"
  );

  const hasRemoteResult = runResults.some((run) =>
    run.events.some(
      (event) =>
        event &&
        event.type === "event" &&
        event.event === "agent.tool_result" &&
        String(event.payload?.output ?? "").includes("mock-runner:bash.exec")
    )
  );
  assert(hasRemoteResult, "agent.run 未返回 docker-runner 输出");

  const now = Date.now();
  const from = new Date(now - 10 * 60 * 1000).toISOString();
  const to = new Date(now + 10 * 60 * 1000).toISOString();

  const auditPage1 = await rpcExpectOk(gateway.port, connectionId, "r_audit_1", "audit.query", {
    tenantId: "t_e2e",
    workspaceId: "w_e2e",
    action: "agent.run.completed",
    from,
    to,
    limit: 1
  });
  const page1Items = asArray(auditPage1.response.payload.items);
  assert(page1Items.length === 1, `audit.query 第1页返回异常: ${String(page1Items.length)}`);
  assert(typeof auditPage1.response.payload.nextCursor === "number", "audit.query 第1页缺少 nextCursor");

  const auditPage2 = await rpcExpectOk(gateway.port, connectionId, "r_audit_2", "audit.query", {
    tenantId: "t_e2e",
    workspaceId: "w_e2e",
    action: "agent.run.completed",
    from,
    to,
    limit: 1,
    cursor: auditPage1.response.payload.nextCursor
  });
  const page2Items = asArray(auditPage2.response.payload.items);
  assert(page2Items.length === 1, `audit.query 第2页返回异常: ${String(page2Items.length)}`);

  const page1Id = Number(page1Items[0]?.id ?? 0);
  const page2Id = Number(page2Items[0]?.id ?? 0);
  assert(page1Id > page2Id, "audit.query 分页 cursor 无效（ID 未递减）");

  await rpcExpectOk(gateway.port, connectionId, "r_audit_3", "audit.query", {
    tenantId: "t_e2e",
    workspaceId: "w_e2e",
    action: "non.existing.action",
    limit: 10
  });

  console.log(`[p2-e2e] gateway=http://127.0.0.1:${gateway.port}`);
  console.log(`[p2-e2e] web-console=http://127.0.0.1:${webConsole.port}`);
  console.log(`[p2-e2e] docker-runner endpoint=${runner.endpoint}`);
  console.log(`[p2-e2e] PASS: remote-exec + audit filter/pagination`);

  await cleanupAll();
}

function buildBackend() {
  console.log("[p2-e2e] building backend...");
  const result = spawnSync(process.execPath, ["scripts/backend-build.mjs"], {
    cwd: rootDir,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function startMockDockerRunner() {
  const calls = [];
  const server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("method_not_allowed");
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      let payload = {};
      try {
        payload = JSON.parse(text);
      } catch {
        payload = {};
      }
      calls.push({
        authorization: String(req.headers.authorization ?? ""),
        payload
      });
      const toolName = String(payload?.call?.name ?? "unknown");
      const response = {
        updates: [
          {
            delta: `runner:${toolName}`,
            at: new Date().toISOString()
          }
        ],
        result: {
          ok: true,
          output: `mock-runner:${toolName}`
        }
      };
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(response));
    });
  });
  await listenServer(server, "127.0.0.1", 0);
  const address = server.address();
  assert(address && typeof address === "object" && typeof address.port === "number", "mock runner 启动失败");
  return {
    server,
    endpoint: `http://127.0.0.1:${address.port}/execute`,
    calls
  };
}

async function startWebConsole(gatewayPort) {
  const viteCli = resolve(rootDir, "apps/web-console/node_modules/vite/bin/vite.js");
  assert(existsSync(viteCli), "缺少 vite 可执行文件，请先安装依赖");
  const port = await findAvailablePort();
  const webNode = resolveWebNodeBinary();
  const nodeOptions = appendNodeOptionRequire(process.env.NODE_OPTIONS ?? "", polyfillPath);
  const child = spawn(
    webNode,
    [viteCli, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: resolve(rootDir, "apps/web-console"),
      env: {
        ...process.env,
        VITE_GATEWAY_BASE_URL: `http://127.0.0.1:${gatewayPort}`,
        NODE_OPTIONS: nodeOptions
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  const logs = [];
  child.stdout.on("data", (chunk) => {
    logs.push(String(chunk));
  });
  child.stderr.on("data", (chunk) => {
    logs.push(String(chunk));
  });

  const started = await waitFor(async () => {
    if (child.exitCode !== null) {
      throw new Error(`web-console 进程退出(${String(child.exitCode)}): ${logs.join("")}`);
    }
    const res = await httpJson({
      method: "GET",
      port,
      path: "/"
    }).catch(() => null);
    return Boolean(res && res.statusCode === 200);
  }, 20_000);

  assert(started, `web-console 未在预期时间内启动: ${logs.join("")}`);
  return {
    process: child,
    port
  };
}

function resolveWebNodeBinary() {
  const envNode = process.env.OPENFOAL_WEB_NODE_BIN;
  if (envNode && supportsViteRuntime(envNode)) {
    return envNode;
  }
  if (supportsViteRuntime(process.execPath)) {
    return process.execPath;
  }

  const candidates = [
    "/Users/rqq/.nvm/versions/node/v22.17.0/bin/node",
    "/Users/rqq/.nvm/versions/node/v18.20.8/bin/node"
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && supportsViteRuntime(candidate)) {
      return candidate;
    }
  }

  throw new Error("未找到可用于 web-console 的 Node.js（需要 >=18）。可设置 OPENFOAL_WEB_NODE_BIN。");
}

function supportsViteRuntime(nodeBin) {
  const out = spawnSync(nodeBin, ["-e", "process.stdout.write(process.versions.node)"], {
    encoding: "utf8"
  });
  if (out.status !== 0) {
    return false;
  }
  const major = Number(String(out.stdout).trim().split(".")[0] ?? "0");
  return Number.isFinite(major) && major >= 18;
}

async function rpcExpectOk(port, connectionId, id, method, params) {
  const rpc = await httpJson({
    method: "POST",
    port,
    path: `/rpc?connectionId=${encodeURIComponent(connectionId)}`,
    body: {
      type: "req",
      id,
      method,
      params
    }
  });
  assert(rpc.statusCode === 200, `${method} HTTP 状态异常: ${String(rpc.statusCode)}`);
  assert(rpc.body?.response?.ok === true, `${method} RPC 失败: ${JSON.stringify(rpc.body?.response?.error ?? {})}`);
  return rpc.body;
}

function httpJson({ method, port, path, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": String(payload.length)
            }
          : undefined
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try {
            parsed = text.length > 0 ? JSON.parse(text) : null;
          } catch {
            parsed = null;
          }
          resolve({
            statusCode: res.statusCode ?? 0,
            body: parsed,
            text
          });
        });
      }
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function appendNodeOptionRequire(existing, filePath) {
  const flag = `--require=${filePath}`;
  const normalized = existing.trim();
  if (!normalized) {
    return flag;
  }
  if (normalized.includes(flag)) {
    return normalized;
  }
  return `${normalized} ${flag}`;
}

async function findAvailablePort() {
  const server = createServer(() => {});
  await listenServer(server, "127.0.0.1", 0);
  const address = server.address();
  await closeServer(server);
  assert(address && typeof address === "object" && typeof address.port === "number", "无法分配本地端口");
  return address.port;
}

async function waitFor(checker, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await checker()) {
        return true;
      }
    } catch {
      // ignore
    }
    await sleep(150);
  }
  return false;
}

function listenServer(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function stopProcess(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function cleanupAll() {
  while (cleanupTasks.length > 0) {
    const task = cleanupTasks.pop();
    try {
      await task();
    } catch {
      // ignore cleanup errors
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}
