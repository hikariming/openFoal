const gatewayBaseUrl = (process.env.OPENFOAL_E2E_GATEWAY_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const webConsoleUrl = (process.env.OPENFOAL_E2E_WEB_CONSOLE_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const connectionId = process.env.OPENFOAL_E2E_CONNECTION_ID ?? `p2_docker_${Date.now().toString(36)}`;
const authUsername = process.env.OPENFOAL_E2E_AUTH_USERNAME ?? "admin";
const authPassword = process.env.OPENFOAL_E2E_AUTH_PASSWORD ?? "admin123!";
const authTenant = process.env.OPENFOAL_E2E_AUTH_TENANT ?? "default";

let accessToken;

await assertHealth(`${gatewayBaseUrl}/health`, "gateway");
await assertPage(webConsoleUrl, "OpenFoal Web Console");
await tryLogin();

await rpc("r_connect", "connect", {
  ...(accessToken
    ? {
        auth: {
          type: "Bearer",
          token: accessToken
        }
      }
    : {})
});
const run = await rpc("r_run", "agent.run", {
  idempotencyKey: "idem_p2_docker_smoke_1",
  sessionId: "s_p2_docker_smoke",
  input: "run [[tool:bash.exec {\"cmd\":\"printf docker-smoke\"}]]",
  runtimeMode: "local",
  tenantId: "t_default",
  workspaceId: "w_default",
  agentId: "a_default",
  actor: "docker-smoke"
});

const hasToolResult = Array.isArray(run.events)
  ? run.events.some((event) => event?.event === "agent.tool_result")
  : false;
if (!hasToolResult) {
  throw new Error("agent.run missing agent.tool_result event");
}

const auditPage1 = await rpc("r_audit_1", "audit.query", {
  tenantId: "t_default",
  workspaceId: "w_default",
  action: "agent.run.completed",
  limit: 1
});
const items1 = asArray(auditPage1.response?.payload?.items);
if (items1.length !== 1) {
  throw new Error(`audit.query page1 invalid length: ${String(items1.length)}`);
}
const targetKind = String(items1[0]?.metadata?.executionTargetKind ?? "");
if (targetKind !== "docker-runner") {
  throw new Error(`expected executionTargetKind=docker-runner, got ${targetKind}`);
}
const nextCursor = Number(auditPage1.response?.payload?.nextCursor ?? 0);
if (!Number.isFinite(nextCursor) || nextCursor <= 0) {
  throw new Error("audit.query page1 missing nextCursor");
}

const auditPage2 = await rpc("r_audit_2", "audit.query", {
  tenantId: "t_default",
  workspaceId: "w_default",
  action: "agent.run.completed",
  limit: 1,
  cursor: nextCursor
});
const items2 = asArray(auditPage2.response?.payload?.items);
if (items2.length < 1) {
  throw new Error("audit.query page2 should return at least one item");
}

console.log("[p2-e2e-docker] PASS: gateway + web-console + docker-runner + audit pagination");

async function rpc(id, method, params) {
  const url = new URL("/rpc", gatewayBaseUrl);
  url.searchParams.set("connectionId", connectionId);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify({
      type: "req",
      id,
      method,
      params
    })
  });
  if (!res.ok) {
    throw new Error(`${method} HTTP ${String(res.status)}`);
  }
  const payload = await res.json();
  if (!payload?.response?.ok) {
    throw new Error(`${method} failed: ${JSON.stringify(payload?.response?.error ?? {})}`);
  }
  return payload;
}

async function tryLogin() {
  try {
    const res = await fetch(`${gatewayBaseUrl}/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        username: authUsername,
        password: authPassword,
        tenant: authTenant
      })
    });
    if (!res.ok) {
      return;
    }
    const payload = await res.json();
    if (typeof payload?.access_token === "string" && payload.access_token.length > 0) {
      accessToken = payload.access_token;
    }
  } catch {
    // auth may be disabled
  }
}

async function assertHealth(url, name) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`${name} health failed: HTTP ${String(res.status)}`);
  }
}

async function assertPage(url, expectedText) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`page ${url} failed: HTTP ${String(res.status)}`);
  }
  const text = await res.text();
  if (!text.includes(expectedText)) {
    throw new Error(`page ${url} missing expected text: ${expectedText}`);
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
