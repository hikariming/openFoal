const gatewayBaseUrl = (process.env.GATEWAY_BASE_URL ?? "http://gateway:8787").replace(/\/$/, "");
const tenantId = process.env.BOOTSTRAP_TENANT_ID ?? "t_default";
const workspaceId = process.env.BOOTSTRAP_WORKSPACE_ID ?? "w_default";
const agentId = process.env.BOOTSTRAP_AGENT_ID ?? "a_default";
const targetId = process.env.BOOTSTRAP_TARGET_ID ?? "target_enterprise_docker";
const actor = process.env.BOOTSTRAP_ACTOR ?? "system-bootstrap";
const runnerEndpoint = process.env.BOOTSTRAP_RUNNER_ENDPOINT ?? "http://docker-runner:8081/execute";
const runnerToken = process.env.BOOTSTRAP_RUNNER_TOKEN ?? "runner-demo-token";
const connectionId = process.env.BOOTSTRAP_CONNECTION_ID ?? "bootstrap_enterprise";
const maxAttempts = Number(process.env.BOOTSTRAP_MAX_ATTEMPTS ?? "60");
const retryMs = Number(process.env.BOOTSTRAP_RETRY_MS ?? "1000");
const authUsername = process.env.BOOTSTRAP_AUTH_USERNAME ?? "admin";
const authPassword = process.env.BOOTSTRAP_AUTH_PASSWORD ?? "admin123!";
const authTenant = process.env.BOOTSTRAP_AUTH_TENANT ?? "default";

let accessToken;

await waitForGatewayHealth();
await tryLogin();

await rpc("r_connect", "connect", {
  client: {
    name: "bootstrap-enterprise",
    version: "0.1.0"
  },
  workspaceId,
  ...(accessToken
    ? {
        auth: {
          type: "Bearer",
          token: accessToken
        }
      }
    : {})
});

await rpc("r_target_upsert", "executionTargets.upsert", {
  idempotencyKey: "idem_bootstrap_target_1",
  tenantId,
  workspaceId,
  targetId,
  kind: "docker-runner",
  endpoint: runnerEndpoint,
  authToken: runnerToken,
  isDefault: true,
  enabled: true,
  actor
});

await rpc("r_agent_upsert", "agents.upsert", {
  idempotencyKey: "idem_bootstrap_agent_1",
  tenantId,
  workspaceId,
  agentId,
  name: "Enterprise Default Agent",
  runtimeMode: "local",
  executionTargetId: targetId,
  enabled: true,
  actor
});

await rpc("r_policy_update", "policy.update", {
  idempotencyKey: "idem_bootstrap_policy_1",
  tenantId,
  workspaceId,
  scopeKey: "default",
  patch: {
    highRisk: "allow"
  },
  actor
});

await rpc("r_budget_update", "budget.update", {
  idempotencyKey: "idem_bootstrap_budget_1",
  scopeKey: `workspace:${tenantId}:${workspaceId}`,
  tokenDailyLimit: 500000,
  costMonthlyUsdLimit: 500,
  hardLimit: true,
  tenantId,
  workspaceId,
  actor
});

console.log(
  `[bootstrap-enterprise] done: tenant=${tenantId} workspace=${workspaceId} agent=${agentId} target=${targetId}`
);

async function waitForGatewayHealth() {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(`${gatewayBaseUrl}/health`, {
        method: "GET"
      });
      if (res.ok) {
        console.log(`[bootstrap-enterprise] gateway is healthy (attempt=${String(attempt)})`);
        return;
      }
    } catch {
      // retry
    }
    await sleep(retryMs);
  }
  throw new Error(`gateway health check timeout after ${String(maxAttempts)} attempts`);
}

async function rpc(id, method, params) {
  const endpoint = new URL("/rpc", gatewayBaseUrl);
  endpoint.searchParams.set("connectionId", connectionId);
  const response = await fetch(endpoint.toString(), {
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

  if (!response.ok) {
    throw new Error(`${method} failed with HTTP ${String(response.status)}`);
  }

  const payload = await response.json();
  if (!payload?.response) {
    throw new Error(`${method} returned invalid envelope`);
  }
  if (payload.response.ok !== true) {
    throw new Error(`${method} failed: ${JSON.stringify(payload.response.error ?? {})}`);
  }
  return payload.response.payload;
}

async function tryLogin() {
  try {
    const response = await fetch(`${gatewayBaseUrl}/auth/login`, {
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
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    if (typeof payload?.access_token === "string" && payload.access_token.length > 0) {
      accessToken = payload.access_token;
      console.log("[bootstrap-enterprise] auth login success");
    }
  } catch {
    // keep backward compatibility when auth is disabled
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
