const gatewayBaseUrl = (process.env.OPENFOAL_E2E_GATEWAY_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const adminTenant = process.env.OPENFOAL_E2E_AUTH_TENANT ?? "default";
const adminUsername = process.env.OPENFOAL_E2E_AUTH_USERNAME ?? "admin";
const adminPassword = process.env.OPENFOAL_E2E_AUTH_PASSWORD ?? "admin123!";

const suffix = Date.now().toString(36);
const userAName = `smoke_a_${suffix}`;
const userBName = `smoke_b_${suffix}`;
const userPassword = "SmokePass123!";

const adminToken = await login(adminUsername, adminPassword, adminTenant);
const adminConn = `smoke_admin_${suffix}`;

await rpc({
  token: adminToken,
  connectionId: adminConn,
  id: "admin_connect",
  method: "connect",
  params: {
    auth: {
      type: "Bearer",
      token: adminToken
    }
  }
});

await rpc({
  token: adminToken,
  connectionId: adminConn,
  id: "create_user_a",
  method: "users.create",
  params: {
    idempotencyKey: `idem_create_user_a_${suffix}`,
    tenantId: "t_default",
    workspaceId: "w_default",
    username: userAName,
    password: userPassword,
    role: "member"
  }
});

await rpc({
  token: adminToken,
  connectionId: adminConn,
  id: "create_user_b",
  method: "users.create",
  params: {
    idempotencyKey: `idem_create_user_b_${suffix}`,
    tenantId: "t_default",
    workspaceId: "w_default",
    username: userBName,
    password: userPassword,
    role: "member"
  }
});

const usersPayload = await rpc({
  token: adminToken,
  connectionId: adminConn,
  id: "users_list",
  method: "users.list",
  params: {
    tenantId: "t_default",
    workspaceId: "w_default"
  }
});

const users = Array.isArray(usersPayload.response?.payload?.items) ? usersPayload.response.payload.items : [];
const userAId = findUserId(users, userAName);
const userBId = findUserId(users, userBName);
if (!userAId || !userBId) {
  throw new Error("failed to resolve created user ids");
}

const userAToken = await login(userAName, userPassword, adminTenant);
const userBToken = await login(userBName, userPassword, adminTenant);

const userAConn = `smoke_user_a_${suffix}`;
await rpc({
  token: userAToken,
  connectionId: userAConn,
  id: "user_a_connect",
  method: "connect",
  params: {
    auth: {
      type: "Bearer",
      token: userAToken
    }
  }
});

await rpc({
  token: userAToken,
  connectionId: userAConn,
  id: "user_a_memory_append",
  method: "memory.appendDaily",
  params: {
    idempotencyKey: `idem_user_a_mem_append_${suffix}`,
    tenantId: "t_default",
    workspaceId: "w_default",
    namespace: "user",
    content: `hello-${suffix}`
  }
});

await rpc({
  token: userAToken,
  connectionId: userAConn,
  id: "user_a_memory_get",
  method: "memory.get",
  params: {
    tenantId: "t_default",
    workspaceId: "w_default",
    namespace: "user"
  }
});

const crossUserRead = await rpcAllowError({
  token: userAToken,
  connectionId: userAConn,
  id: "user_a_read_user_b",
  method: "memory.get",
  params: {
    tenantId: "t_default",
    workspaceId: "w_default",
    namespace: "user",
    userId: userBId
  }
});
if (crossUserRead.response?.ok !== false || crossUserRead.response?.error?.code !== "FORBIDDEN") {
  throw new Error(`cross user memory read should be FORBIDDEN, got: ${JSON.stringify(crossUserRead)}`);
}

const mismatch = await rpcRaw({
  token: userBToken,
  connectionId: userAConn,
  id: "token_mismatch_check",
  method: "sessions.list",
  params: {
    tenantId: "t_default",
    workspaceId: "w_default"
  }
});
if (mismatch.status !== 401) {
  throw new Error(`connection token mismatch should return HTTP 401, got ${mismatch.status}`);
}

await rpc({
  token: adminToken,
  connectionId: adminConn,
  id: "infra_health",
  method: "infra.health",
  params: {
    tenantId: "t_default"
  }
});

await rpc({
  token: adminToken,
  connectionId: adminConn,
  id: "infra_reconcile",
  method: "infra.storage.reconcile",
  params: {
    idempotencyKey: `idem_infra_reconcile_${suffix}`,
    tenantId: "t_default"
  }
});

await rpc({
  token: adminToken,
  connectionId: adminConn,
  id: "audit_query",
  method: "audit.query",
  params: {
    tenantId: "t_default",
    workspaceId: "w_default",
    limit: 5
  }
});

console.log("[smoke-enterprise-full] PASS");

function findUserId(items, username) {
  for (const item of items) {
    const candidateName = item?.user?.username;
    if (candidateName === username) {
      return item?.user?.id;
    }
  }
  return undefined;
}

async function login(username, password, tenant) {
  const res = await fetch(`${gatewayBaseUrl}/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      tenant,
      username,
      password
    })
  });
  if (!res.ok) {
    throw new Error(`login failed: ${username} HTTP ${res.status}`);
  }
  const payload = await res.json();
  if (typeof payload?.access_token !== "string" || payload.access_token.length === 0) {
    throw new Error(`login missing access_token for user ${username}`);
  }
  return payload.access_token;
}

async function rpc({ token, connectionId, id, method, params }) {
  const response = await rpcRaw({ token, connectionId, id, method, params });
  if (response.status !== 200) {
    throw new Error(`${method} failed with HTTP ${response.status}`);
  }
  if (!response.payload?.response?.ok) {
    throw new Error(`${method} failed: ${JSON.stringify(response.payload?.response?.error ?? {})}`);
  }
  return response.payload;
}

async function rpcAllowError({ token, connectionId, id, method, params }) {
  const response = await rpcRaw({ token, connectionId, id, method, params });
  if (response.status !== 200) {
    throw new Error(`${method} expected HTTP 200 but got ${response.status}`);
  }
  return response.payload;
}

async function rpcRaw({ token, connectionId, id, method, params }) {
  const url = new URL("/rpc", gatewayBaseUrl);
  url.searchParams.set("connectionId", connectionId);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      type: "req",
      id,
      method,
      params
    })
  });
  let payload;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return {
    status: res.status,
    payload
  };
}
