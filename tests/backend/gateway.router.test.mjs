import test from "node:test";
import assert from "node:assert/strict";

import { createConnectionState, createGatewayRouter } from "../../apps/gateway/dist/index.js";

function req(id, method, params = {}) {
  return {
    type: "req",
    id,
    method,
    params
  };
}

test("requires connect before other methods", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();

  const result = await router.handle(req("r1", "sessions.list", {}), state);
  assert.equal(result.response.ok, false);
  if (!result.response.ok) {
    assert.equal(result.response.error.code, "UNAUTHORIZED");
  }
});

test("connect then sessions.list works", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();

  const connected = await router.handle(req("r_connect", "connect", { auth: { token: "x" } }), state);
  assert.equal(connected.response.ok, true);

  const listed = await router.handle(req("r_list", "sessions.list", {}), state);
  assert.equal(listed.response.ok, true);
  if (listed.response.ok) {
    const items = listed.response.payload.items;
    assert.equal(Array.isArray(items), true);
    assert.equal(items.length > 0, true);
  }
});

test("context.get returns default template when scoped file is missing", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);
  state.principal = {
    subject: "u_ctx_missing",
    userId: "u_ctx_missing",
    tenantId: "t_ctx_missing",
    workspaceIds: ["w_ctx_missing"],
    roles: ["tenant_admin"],
    authSource: "local"
  };

  const result = await router.handle(
    req("r_context_missing", "context.get", {
      layer: "tenant",
      file: "TOOLS.md",
      tenantId: "t_ctx_missing",
      workspaceId: "w_ctx_missing"
    }),
    state
  );

  assert.equal(result.response.ok, true);
  if (result.response.ok) {
    const context = result.response.payload.context;
    assert.equal(context.layer, "tenant");
    assert.equal(context.file, "TOOLS.md");
    assert.equal(typeof context.text, "string");
    assert.equal(context.text.includes("Prefer workspace-safe tools."), true);
  }
});

test("context.get falls back to legacy scoped root when new root is missing", async () => {
  const reads = [];
  const router = createGatewayRouter({
    internalToolExecutor: {
      async execute(call, ctx) {
        if (call.name !== "file.read") {
          return {
            ok: false,
            error: {
              code: "TOOL_EXEC_FAILED",
              message: "unsupported call"
            }
          };
        }
        reads.push(String(ctx.workspaceRoot ?? ""));
        if (String(ctx.workspaceRoot ?? "").endsWith("/.openfoal/context")) {
          return {
            ok: false,
            error: {
              code: "TOOL_EXEC_FAILED",
              message: "ENOENT: scoped context not found"
            }
          };
        }
        if (String(ctx.workspaceRoot ?? "").includes("/skills/tenant")) {
          return {
            ok: true,
            output: "# TOOLS.md\n\nlegacy scoped context\n"
          };
        }
        return {
          ok: false,
          error: {
            code: "TOOL_EXEC_FAILED",
            message: "ENOENT: unknown context root"
          }
        };
      }
    }
  });
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);
  state.principal = {
    subject: "u_ctx_legacy",
    userId: "u_ctx_legacy",
    tenantId: "t_ctx_legacy",
    workspaceIds: ["w_ctx_legacy"],
    roles: ["tenant_admin"],
    authSource: "local"
  };

  const result = await router.handle(
    req("r_context_legacy_fallback", "context.get", {
      layer: "tenant",
      file: "TOOLS.md",
      tenantId: "t_ctx_legacy",
      workspaceId: "w_ctx_legacy"
    }),
    state
  );

  assert.equal(result.response.ok, true);
  if (result.response.ok) {
    const context = result.response.payload.context;
    assert.equal(context.file, "TOOLS.md");
    assert.match(String(context.text), /legacy scoped context/);
  }
  assert.equal(reads.some((item) => item.endsWith("/.openfoal/context")), true);
  assert.equal(reads.some((item) => item.includes("/skills/tenant")), true);
});

test("context.upsert writes into .openfoal/context root", async () => {
  let writeRoot = "";
  const router = createGatewayRouter({
    internalToolExecutor: {
      async execute(call, ctx) {
        if (call.name === "file.write") {
          writeRoot = String(ctx.workspaceRoot ?? "");
          return {
            ok: true,
            output: ""
          };
        }
        return {
          ok: false,
          error: {
            code: "TOOL_EXEC_FAILED",
            message: "unsupported call"
          }
        };
      }
    }
  });
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);
  state.principal = {
    subject: "u_ctx_write",
    userId: "u_ctx_write",
    tenantId: "t_ctx_write",
    workspaceIds: ["w_ctx_write"],
    roles: ["tenant_admin"],
    authSource: "local"
  };

  const result = await router.handle(
    req("r_context_upsert_scoped", "context.upsert", {
      idempotencyKey: "idem_context_upsert_scoped_1",
      layer: "tenant",
      file: "TOOLS.md",
      content: "# TOOLS.md\n\nnew scoped content",
      tenantId: "t_ctx_write",
      workspaceId: "w_ctx_write"
    }),
    state
  );

  assert.equal(result.response.ok, true);
  assert.equal(writeRoot.endsWith("/.openfoal/context"), true);
});

test("sessions.create creates a session and sessions.list returns it", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const created = await router.handle(
    req("r_create", "sessions.create", {
      idempotencyKey: "idem_session_create_1",
      title: "my workspace session",
      runtimeMode: "cloud"
    }),
    state
  );

  assert.equal(created.response.ok, true);
  if (created.response.ok) {
    const session = created.response.payload.session;
    assert.equal(typeof session?.id, "string");
    assert.equal(session?.title, "my workspace session");
    assert.equal(session?.runtimeMode, "cloud");
    assert.equal(typeof session?.contextUsage, "number");
    assert.equal(typeof session?.compactionCount, "number");
    assert.equal(typeof session?.memoryFlushState, "string");
  }

  const listed = await router.handle(req("r_list_after_create", "sessions.list", {}), state);
  assert.equal(listed.response.ok, true);
  if (listed.response.ok && created.response.ok) {
    const items = listed.response.payload.items;
    assert.equal(Array.isArray(items), true);
    assert.equal(items.some((item) => item.id === created.response.payload.session.id), true);
  }
});

test("sessions.list recovers legacy default-scope sessions for principal and keeps history", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  state.principal = {
    subject: "u_recover_scope",
    tenantId: "t_enterprise_scope",
    workspaceIds: ["w_enterprise_scope"],
    roles: ["member"],
    authSource: "local",
    claims: {}
  };
  await router.handle(req("r_connect", "connect", {}), state);

  const createdLegacy = await router.handle(
    req("r_create_legacy_scope_session", "sessions.create", {
      idempotencyKey: "idem_create_legacy_scope_session_1",
      tenantId: "t_default",
      workspaceId: "w_default",
      title: "legacy scope session",
      runtimeMode: "local"
    }),
    state
  );
  assert.equal(createdLegacy.response.ok, true);
  const legacySessionId = createdLegacy.response.ok ? createdLegacy.response.payload.session?.id : undefined;
  assert.equal(typeof legacySessionId, "string");

  const legacyRun = await router.handle(
    req("r_run_legacy_scope_session", "agent.run", {
      idempotencyKey: "idem_run_legacy_scope_session_1",
      sessionId: legacySessionId,
      input: "legacy transcript survives",
      runtimeMode: "local",
      tenantId: "t_default",
      workspaceId: "w_default"
    }),
    state
  );
  assert.equal(legacyRun.response.ok, true);

  const listed = await router.handle(req("r_list_recovered_scope", "sessions.list", {}), state);
  assert.equal(listed.response.ok, true);
  if (listed.response.ok) {
    const items = listed.response.payload.items;
    assert.equal(Array.isArray(items), true);
    const recovered = items.find((item) => item.id === legacySessionId);
    assert.equal(Boolean(recovered), true);
    assert.equal(recovered?.tenantId, "t_enterprise_scope");
    assert.equal(recovered?.workspaceId, "w_enterprise_scope");
  }

  const history = await router.handle(
    req("r_history_recovered_scope", "sessions.history", {
      sessionId: legacySessionId,
      limit: 200
    }),
    state
  );
  assert.equal(history.response.ok, true);
  if (history.response.ok) {
    const items = history.response.payload.items;
    assert.equal(Array.isArray(items), true);
    assert.equal(items.some((item) => item.event === "user.input"), true);
  }
});

test("agent.run returns stream events", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const run = await router.handle(
    req("r_run", "agent.run", {
      idempotencyKey: "idem_run_1",
      sessionId: "s_default",
      input: "hello openfoal",
      runtimeMode: "local"
    }),
    state
  );

  assert.equal(run.response.ok, true);
  if (run.response.ok) {
    assert.equal(typeof run.response.payload.runId, "string");
  }

  const eventNames = run.events.map((event) => event.event);
  assert.equal(eventNames.includes("agent.accepted"), true);
  assert.equal(eventNames.includes("agent.delta"), true);
  assert.equal(eventNames.includes("agent.completed"), true);
});

test("agent.run updates default title and sessions.history includes user.input", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const run = await router.handle(
    req("r_run_with_history", "agent.run", {
      idempotencyKey: "idem_run_with_history_1",
      sessionId: "s_default",
      input: "first message becomes title",
      runtimeMode: "local"
    }),
    state
  );
  assert.equal(run.response.ok, true);

  const details = await router.handle(
    req("r_get_after_run", "sessions.get", {
      sessionId: "s_default"
    }),
    state
  );
  assert.equal(details.response.ok, true);
  if (details.response.ok) {
    assert.equal(details.response.payload.session?.title, "first message becomes title");
    assert.equal(details.response.payload.session?.preview, "first message becomes title");
    assert.equal(typeof details.response.payload.session?.contextUsage, "number");
    assert.equal(typeof details.response.payload.session?.compactionCount, "number");
    assert.equal(typeof details.response.payload.session?.memoryFlushState, "string");
  }

  const history = await router.handle(
    req("r_history", "sessions.history", {
      sessionId: "s_default",
      limit: 200
    }),
    state
  );
  assert.equal(history.response.ok, true);
  if (history.response.ok) {
    const items = history.response.payload.items;
    assert.equal(Array.isArray(items), true);
    assert.equal(items.some((item) => item.event === "user.input"), true);
    assert.equal(items.some((item) => item.event === "agent.completed"), true);
  }
});

test("agent.run forwards llm modelRef/provider/modelId", async () => {
  let capturedInput;
  const router = createGatewayRouter({
    coreService: {
      async *run(input) {
        capturedInput = input;
        yield {
          type: "accepted",
          runId: "run_llm_1",
          sessionId: input.sessionId,
          runtimeMode: input.runtimeMode
        };
        yield {
          type: "completed",
          runId: "run_llm_1",
          output: "ok"
        };
      },
      async *continue() {},
      async abort() {}
    }
  });
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const run = await router.handle(
    req("r_run_llm", "agent.run", {
      idempotencyKey: "idem_model_ref_1",
      sessionId: "s_default",
      input: "hello",
      runtimeMode: "local",
      llm: {
        modelRef: "openai-fast",
        provider: "openai",
        modelId: "gpt-4o-mini"
      }
    }),
    state
  );

  assert.equal(run.response.ok, true);
  assert.equal(capturedInput?.llm?.modelRef, "openai-fast");
  assert.equal(capturedInput?.llm?.provider, "openai");
  assert.equal(capturedInput?.llm?.modelId, "gpt-4o-mini");
  const accepted = run.events.find((event) => event.event === "agent.accepted");
  assert.equal(accepted?.payload?.llm?.modelRef, "openai-fast");
  assert.equal(accepted?.payload?.llm?.provider, "openai");
  assert.equal(accepted?.payload?.llm?.modelId, "gpt-4o-mini");
  assert.equal(accepted?.payload?.llm?.apiKey, undefined);
});

test("agent.run over HTTP keeps compatibility event set", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const run = await router.handle(
    req("r_run", "agent.run", {
      idempotencyKey: "idem_http_compat_1",
      sessionId: "s_default",
      input: "run [[tool:text.upper {\"text\": \"hello\"}]]",
      runtimeMode: "local"
    }),
    state
  );

  assert.equal(run.response.ok, true);
  const eventNames = run.events.map((event) => event.event);
  assert.equal(eventNames.includes("agent.tool_call"), true);
  assert.equal(eventNames.includes("agent.tool_result"), true);
  assert.equal(eventNames.includes("agent.tool_call_start"), false);
  assert.equal(eventNames.includes("agent.tool_call_delta"), false);
  assert.equal(eventNames.includes("agent.tool_result_start"), false);
  assert.equal(eventNames.includes("agent.tool_result_delta"), false);
});

test("idempotency replay and conflict", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const first = await router.handle(
    req("r_run_1", "agent.run", {
      idempotencyKey: "idem_same",
      sessionId: "s_default",
      input: "same input",
      runtimeMode: "local"
    }),
    state
  );

  const replay = await router.handle(
    req("r_run_2", "agent.run", {
      idempotencyKey: "idem_same",
      sessionId: "s_default",
      input: "same input",
      runtimeMode: "local"
    }),
    state
  );

  assert.deepEqual(replay, first);

  const conflict = await router.handle(
    req("r_run_3", "agent.run", {
      idempotencyKey: "idem_same",
      sessionId: "s_default",
      input: "different input",
      runtimeMode: "local"
    }),
    state
  );

  assert.equal(conflict.response.ok, false);
  if (!conflict.response.ok) {
    assert.equal(conflict.response.error.code, "IDEMPOTENCY_CONFLICT");
  }
});

test("runtime.setMode queues when running and applies when idle", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  state.runningSessionIds.add("s_default");
  const queued = await router.handle(
    req("r_mode_queue", "runtime.setMode", {
      idempotencyKey: "idem_mode_1",
      sessionId: "s_default",
      runtimeMode: "cloud"
    }),
    state
  );

  assert.equal(queued.response.ok, true);
  if (queued.response.ok) {
    assert.equal(queued.response.payload.status, "queued-change");
  }
  assert.equal(queued.events.length, 0);

  state.runningSessionIds.delete("s_default");
  const applied = await router.handle(
    req("r_mode_apply", "runtime.setMode", {
      idempotencyKey: "idem_mode_2",
      sessionId: "s_default",
      runtimeMode: "cloud"
    }),
    state
  );

  assert.equal(applied.response.ok, true);
  if (applied.response.ok) {
    assert.equal(applied.response.payload.status, "applied");
  }
  assert.equal(applied.events.some((event) => event.event === "runtime.mode_changed"), true);
});

test("agent.run cloud unreachable follows deny/fallback_local policy", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const targetUpsert = await router.handle(
    req("r_target_unreachable", "executionTargets.upsert", {
      idempotencyKey: "idem_target_unreachable_1",
      tenantId: "t_default",
      workspaceId: "w_default",
      targetId: "target_cloud_unreachable",
      kind: "docker-runner",
      endpoint: "http://127.0.0.1:1/runner",
      isDefault: false,
      enabled: true
    }),
    state
  );
  assert.equal(targetUpsert.response.ok, true);

  const denied = await router.handle(
    req("r_cloud_deny", "agent.run", {
      idempotencyKey: "idem_cloud_deny_1",
      sessionId: "s_cloud_deny",
      input: "try cloud with deny policy",
      runtimeMode: "cloud",
      executionTargetId: "target_cloud_unreachable",
      cloudFailurePolicy: "deny"
    }),
    state
  );
  assert.equal(denied.response.ok, false);
  if (!denied.response.ok) {
    assert.equal(denied.response.error.code, "MODEL_UNAVAILABLE");
  }

  const fallback = await router.handle(
    req("r_cloud_fallback", "agent.run", {
      idempotencyKey: "idem_cloud_fallback_1",
      sessionId: "s_cloud_fallback",
      input: "try cloud with fallback policy",
      runtimeMode: "cloud",
      executionTargetId: "target_cloud_unreachable",
      cloudFailurePolicy: "fallback_local"
    }),
    state
  );
  assert.equal(fallback.response.ok, true);
  assert.equal(
    fallback.events.some(
      (event) =>
        event.event === "runtime.mode_changed" &&
        event.payload?.status === "fallback-local" &&
        event.payload?.executionMode === "local_sandbox"
    ),
    true
  );

  const audits = await router.handle(
    req("r_audit_cloud_policy", "audit.query", {
      tenantId: "t_default",
      workspaceId: "w_default",
      action: "execution.mode_changed",
      limit: 20
    }),
    state
  );
  assert.equal(audits.response.ok, true);
  if (audits.response.ok) {
    const items = Array.isArray(audits.response.payload.items) ? audits.response.payload.items : [];
    assert.equal(
      items.some((item) => item?.metadata?.status === "cloud-unreachable-denied"),
      true
    );
    assert.equal(
      items.some((item) => item?.metadata?.status === "fallback-local"),
      true
    );
  }
});

test("policy.get/policy.update returns structured policy", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const before = await router.handle(req("r_policy_get_before", "policy.get", {}), state);
  assert.equal(before.response.ok, true);
  let beforeVersion = 0;
  if (before.response.ok) {
    const policy = before.response.payload.policy;
    assert.equal(typeof policy?.version, "number");
    assert.equal(typeof policy?.updatedAt, "string");
    beforeVersion = policy.version;
  }

  const updated = await router.handle(
    req("r_policy_update", "policy.update", {
      idempotencyKey: "idem_policy_update_1",
      patch: {
        toolDefault: "allow"
      }
    }),
    state
  );
  assert.equal(updated.response.ok, true);
  if (updated.response.ok) {
    const policy = updated.response.payload.policy;
    assert.equal(policy.toolDefault, "allow");
    assert.equal(policy.version > beforeVersion, true);
    assert.equal(typeof policy.updatedAt, "string");
  }
});

test("agents/executionTargets/budget APIs are available and audit.query returns records", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const targetUpsert = await router.handle(
    req("r_target_upsert", "executionTargets.upsert", {
      idempotencyKey: "idem_target_upsert_1",
      tenantId: "t_default",
      workspaceId: "w_default",
      targetId: "target_router_docker",
      kind: "docker-runner",
      endpoint: "http://runner.internal",
      isDefault: true,
      enabled: true
    }),
    state
  );
  assert.equal(targetUpsert.response.ok, true);

  const agentUpsert = await router.handle(
    req("r_agent_upsert", "agents.upsert", {
      idempotencyKey: "idem_agent_upsert_1",
      tenantId: "t_default",
      workspaceId: "w_default",
      agentId: "a_support",
      name: "support",
      executionTargetId: "target_router_docker",
      runtimeMode: "cloud"
    }),
    state
  );
  assert.equal(agentUpsert.response.ok, true);

  const budgetUpdate = await router.handle(
    req("r_budget_update", "budget.update", {
      idempotencyKey: "idem_budget_update_1",
      scopeKey: "workspace:t_default:w_default",
      tokenDailyLimit: 2000,
      costMonthlyUsdLimit: 20,
      hardLimit: true
    }),
    state
  );
  assert.equal(budgetUpdate.response.ok, true);

  const targetsList = await router.handle(
    req("r_targets_list", "executionTargets.list", {
      tenantId: "t_default",
      workspaceId: "w_default"
    }),
    state
  );
  assert.equal(targetsList.response.ok, true);
  if (targetsList.response.ok) {
    assert.equal(Array.isArray(targetsList.response.payload.items), true);
    assert.equal(targetsList.response.payload.items.some((item) => item.targetId === "target_router_docker"), true);
  }

  const agentsList = await router.handle(
    req("r_agents_list", "agents.list", {
      tenantId: "t_default",
      workspaceId: "w_default"
    }),
    state
  );
  assert.equal(agentsList.response.ok, true);
  if (agentsList.response.ok) {
    assert.equal(Array.isArray(agentsList.response.payload.items), true);
    assert.equal(agentsList.response.payload.items.some((item) => item.agentId === "a_support"), true);
  }

  const budgetGet = await router.handle(
    req("r_budget_get", "budget.get", {
      scopeKey: "workspace:t_default:w_default"
    }),
    state
  );
  assert.equal(budgetGet.response.ok, true);
  if (budgetGet.response.ok) {
    assert.equal(budgetGet.response.payload.policy.scopeKey, "workspace:t_default:w_default");
    assert.equal(typeof budgetGet.response.payload.usage.tokensUsedDaily, "number");
  }

  const audit = await router.handle(
    req("r_audit_query", "audit.query", {
      tenantId: "t_default",
      workspaceId: "w_default",
      limit: 20
    }),
    state
  );
  assert.equal(audit.response.ok, true);
  if (audit.response.ok) {
    assert.equal(Array.isArray(audit.response.payload.items), true);
    assert.equal(audit.response.payload.items.length >= 3, true);
  }
});

test("budget hard limit rejects new agent.run and writes audit", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const policy = await router.handle(
    req("r_budget_update_hard", "budget.update", {
      idempotencyKey: "idem_budget_hard_1",
      scopeKey: "workspace:t_default:w_default",
      tokenDailyLimit: 0,
      hardLimit: true
    }),
    state
  );
  assert.equal(policy.response.ok, true);

  const run = await router.handle(
    req("r_run_budget_reject", "agent.run", {
      idempotencyKey: "idem_run_budget_reject_1",
      sessionId: "s_default",
      input: "hello should reject by budget",
      runtimeMode: "local",
      tenantId: "t_default",
      workspaceId: "w_default",
      budgetLevel: "workspace"
    }),
    state
  );
  assert.equal(run.response.ok, false);
  if (!run.response.ok) {
    assert.equal(run.response.error.code, "POLICY_DENIED");
    assert.match(run.response.error.message, /预算超限/);
  }

  const audit = await router.handle(
    req("r_audit_budget_reject", "audit.query", {
      action: "budget.rejected",
      tenantId: "t_default",
      workspaceId: "w_default",
      limit: 10
    }),
    state
  );
  assert.equal(audit.response.ok, true);
  if (audit.response.ok) {
    assert.equal(Array.isArray(audit.response.payload.items), true);
    assert.equal(audit.response.payload.items.length >= 1, true);
  }
});

test("docker-runner target executes tool via remote endpoint", async () => {
  let capturedInvoke = null;
  const router = createGatewayRouter({
    dockerRunnerInvoker: async (invokeInput) => {
      capturedInvoke = invokeInput;
      return {
        ok: true,
        output: "from-remote-runner"
      };
    }
  });
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const target = await router.handle(
    req("r_target_remote", "executionTargets.upsert", {
      idempotencyKey: "idem_target_remote_1",
      tenantId: "t_remote",
      workspaceId: "w_remote",
      targetId: "target_remote_runner",
      kind: "docker-runner",
      endpoint: "http://runner.internal/execute",
      authToken: "runner-secret",
      isDefault: true,
      enabled: true
    }),
    state
  );
  assert.equal(target.response.ok, true);

  const agent = await router.handle(
    req("r_agent_remote", "agents.upsert", {
      idempotencyKey: "idem_agent_remote_1",
      tenantId: "t_remote",
      workspaceId: "w_remote",
      agentId: "a_remote",
      name: "remote",
      executionTargetId: "target_remote_runner",
      runtimeMode: "local"
    }),
    state
  );
  assert.equal(agent.response.ok, true);

  const run = await router.handle(
    req("r_run_remote", "agent.run", {
      idempotencyKey: "idem_run_remote_1",
      sessionId: "s_remote",
      input: "run [[tool:bash.exec {\"cmd\":\"printf local\"}]]",
      runtimeMode: "local",
      tenantId: "t_remote",
      workspaceId: "w_remote",
      agentId: "a_remote"
    }),
    state
  );
  assert.equal(run.response.ok, true);
  assert.equal(capturedInvoke?.target?.targetId, "target_remote_runner");
  assert.equal(capturedInvoke?.target?.kind, "docker-runner");
  assert.equal(capturedInvoke?.call?.name, "bash.exec");
  assert.equal(capturedInvoke?.ctx?.sessionId, "s_remote");

  const toolResult = run.events.find((event) => event.event === "agent.tool_result");
  assert.match(String(toolResult?.payload?.output ?? ""), /from-remote-runner/);
});

test("users and secrets management APIs are available", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const created = await router.handle(
    req("r_users_create", "users.create", {
      idempotencyKey: "idem_users_create_1",
      tenantId: "t_default",
      username: "alice",
      password: "alice123!",
      displayName: "Alice",
      memberships: [
        {
          workspaceId: "w_default",
          role: "member"
        }
      ]
    }),
    state
  );
  assert.equal(created.response.ok, true);

  const listed = await router.handle(
    req("r_users_list", "users.list", {
      tenantId: "t_default"
    }),
    state
  );
  assert.equal(listed.response.ok, true);
  let userId = "";
  if (listed.response.ok) {
    const items = listed.response.payload.items;
    assert.equal(Array.isArray(items), true);
    const alice = items.find((item) => item.user?.username === "alice");
    assert.equal(Boolean(alice), true);
    userId = String(alice?.user?.id ?? "");
  }
  assert.equal(userId.length > 0, true);

  const status = await router.handle(
    req("r_users_status", "users.updateStatus", {
      idempotencyKey: "idem_users_status_1",
      tenantId: "t_default",
      userId,
      status: "disabled"
    }),
    state
  );
  assert.equal(status.response.ok, true);

  const reset = await router.handle(
    req("r_users_reset", "users.resetPassword", {
      idempotencyKey: "idem_users_reset_1",
      tenantId: "t_default",
      userId,
      newPassword: "alice456!"
    }),
    state
  );
  assert.equal(reset.response.ok, true);

  const memberships = await router.handle(
    req("r_users_membership", "users.updateMemberships", {
      idempotencyKey: "idem_users_membership_1",
      tenantId: "t_default",
      userId,
      memberships: [
        {
          workspaceId: "w_default",
          role: "workspace_admin"
        }
      ]
    }),
    state
  );
  assert.equal(memberships.response.ok, true);

  const secret = await router.handle(
    req("r_secret_upsert", "secrets.upsertModelKey", {
      idempotencyKey: "idem_secret_upsert_1",
      tenantId: "t_default",
      workspaceId: "w_default",
      provider: "openai",
      apiKey: "sk-test-openfoal-secret-1234",
      modelId: "gpt-4o-mini"
    }),
    state
  );
  assert.equal(secret.response.ok, true);
  if (secret.response.ok) {
    assert.equal(typeof secret.response.payload.secret?.maskedKey, "string");
    assert.equal(secret.response.payload.secret?.keyLast4, "1234");
  }

  const secretDefaultWorkspace = await router.handle(
    req("r_secret_upsert_default_workspace", "secrets.upsertModelKey", {
      idempotencyKey: "idem_secret_upsert_default_workspace_1",
      tenantId: "t_default",
      provider: "kimi",
      apiKey: "sk-test-openfoal-secret-5678",
      modelId: "kimi-k2.5"
    }),
    state
  );
  assert.equal(secretDefaultWorkspace.response.ok, true);
  if (secretDefaultWorkspace.response.ok) {
    assert.equal(secretDefaultWorkspace.response.payload.secret?.workspaceId, "w_default");
    assert.equal(secretDefaultWorkspace.response.payload.secret?.keyLast4, "5678");
  }

  const secretMeta = await router.handle(
    req("r_secret_meta", "secrets.getModelKeyMeta", {
      tenantId: "t_default"
    }),
    state
  );
  assert.equal(secretMeta.response.ok, true);
  if (secretMeta.response.ok) {
    const items = secretMeta.response.payload.items;
    assert.equal(Array.isArray(items), true);
    assert.equal(items.some((item) => item.provider === "openai"), true);
  }
});

test("agent.run resolves llm apiKey from secrets repository", async () => {
  let capturedInput = null;
  const router = createGatewayRouter({
    coreService: {
      async *run(input) {
        capturedInput = input;
        yield {
          type: "accepted",
          runId: "run_secret_1",
          sessionId: input.sessionId,
          runtimeMode: input.runtimeMode
        };
        yield {
          type: "completed",
          runId: "run_secret_1",
          output: "ok"
        };
      },
      async *continue() {},
      async abort() {}
    }
  });
  const state = createConnectionState();
  state.principal = {
    subject: "u_admin",
    tenantId: "t_scope_secret",
    workspaceIds: ["w_scope_secret"],
    roles: ["tenant_admin"],
    authSource: "local",
    claims: {}
  };
  await router.handle(req("r_connect", "connect", {}), state);

  const secret = await router.handle(
    req("r_secret_upsert_run", "secrets.upsertModelKey", {
      idempotencyKey: "idem_secret_upsert_run_1",
      tenantId: "t_scope_secret",
      workspaceId: "w_scope_secret",
      provider: "openai",
      apiKey: "sk-enterprise-from-secret-7788",
      modelId: "gpt-4o-mini"
    }),
    state
  );
  assert.equal(secret.response.ok, true);

  const run = await router.handle(
    req("r_run_secret", "agent.run", {
      idempotencyKey: "idem_run_secret_1",
      sessionId: "s_default",
      input: "hello",
      runtimeMode: "local",
      llm: {
        provider: "openai",
        modelId: "gpt-4o-mini",
        apiKey: "sk-user-input-should-not-win"
      }
    }),
    state
  );
  assert.equal(run.response.ok, true);
  assert.equal(capturedInput?.llm?.provider, "openai");
  assert.equal(capturedInput?.llm?.apiKey, "sk-enterprise-from-secret-7788");
  const accepted = run.events.find((event) => event.event === "agent.accepted");
  assert.equal(accepted?.payload?.llm?.provider, "openai");
  assert.equal(accepted?.payload?.llm?.modelId, "gpt-4o-mini");
  assert.equal(accepted?.payload?.llm?.apiKey, undefined);

  const secretAlias = await router.handle(
    req("r_secret_upsert_alias", "secrets.upsertModelKey", {
      idempotencyKey: "idem_secret_upsert_alias_1",
      tenantId: "t_scope_secret",
      workspaceId: "w_scope_secret",
      provider: "kimi-k2.5",
      apiKey: "sk-enterprise-kimi-5566",
      modelId: "kimi-k2.5",
      baseUrl: "https://api.moonshot.cn/v1"
    }),
    state
  );
  assert.equal(secretAlias.response.ok, true);

  const runAlias = await router.handle(
    req("r_run_secret_alias", "agent.run", {
      idempotencyKey: "idem_run_secret_alias_1",
      sessionId: "s_default_alias",
      input: "hello alias",
      runtimeMode: "local",
      llm: {
        provider: "kimi-k2.5",
        modelId: "k2p5"
      }
    }),
    state
  );
  assert.equal(runAlias.response.ok, true);
  assert.equal(capturedInput?.llm?.provider, "kimi");
  assert.equal(capturedInput?.llm?.modelId, "kimi-k2.5");
  assert.equal(capturedInput?.llm?.apiKey, "sk-enterprise-kimi-5566");
  const acceptedAlias = runAlias.events.find((event) => event.event === "agent.accepted");
  assert.equal(acceptedAlias?.payload?.llm?.provider, "kimi");
  assert.equal(acceptedAlias?.payload?.llm?.modelId, "kimi-k2.5");
  assert.equal(acceptedAlias?.payload?.llm?.baseUrl, "https://api.moonshot.cn/v1");
  assert.equal(acceptedAlias?.payload?.llm?.apiKey, undefined);
});

test("secrets.getModelKeyMeta defaults to principal scope when params are omitted", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  state.principal = {
    subject: "u_meta_scope",
    tenantId: "t_meta_scope",
    workspaceIds: ["w_meta_scope"],
    roles: ["tenant_admin"],
    authSource: "local",
    claims: {}
  };
  await router.handle(req("r_connect", "connect", {}), state);

  const scopedSecret = await router.handle(
    req("r_secret_scope_upsert", "secrets.upsertModelKey", {
      idempotencyKey: "idem_secret_scope_upsert_1",
      tenantId: "t_meta_scope",
      workspaceId: "w_meta_scope",
      provider: "openai",
      apiKey: "sk-scope-meta-1111",
      modelId: "gpt-4o-mini"
    }),
    state
  );
  assert.equal(scopedSecret.response.ok, true);

  const otherSecret = await router.handle(
    req("r_secret_other_upsert", "secrets.upsertModelKey", {
      idempotencyKey: "idem_secret_other_upsert_1",
      tenantId: "t_other_tenant",
      workspaceId: "w_other_workspace",
      provider: "deepseek",
      apiKey: "sk-scope-meta-2222",
      modelId: "deepseek-chat"
    }),
    state
  );
  assert.equal(otherSecret.response.ok, true);

  const meta = await router.handle(
    req("r_secret_meta_scope_default", "secrets.getModelKeyMeta", {}),
    state
  );
  assert.equal(meta.response.ok, true);
  if (meta.response.ok) {
    const items = meta.response.payload.items;
    assert.equal(Array.isArray(items), true);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.tenantId, "t_meta_scope");
    assert.equal(items[0]?.workspaceId, "w_meta_scope");
    assert.equal(items[0]?.provider, "openai");
  }
});

test("high-risk tools run directly", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const run = await router.handle(
    req("r_run_high_risk_direct", "agent.run", {
      idempotencyKey: "idem_run_high_risk_direct_1",
      sessionId: "s_default",
      input: "run [[tool:bash.exec {\"cmd\":\"echo high-risk-direct\"}]]",
      runtimeMode: "local"
    }),
    state
  );
  assert.equal(run.response.ok, true);
  assert.equal(run.events.some((event) => event.event === "agent.completed"), true);
});

test("metrics.summary returns real aggregate fields", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  await router.handle(
    req("r_run_metrics_1", "agent.run", {
      idempotencyKey: "idem_run_metrics_1",
      sessionId: "s_default",
      input: "hello metrics",
      runtimeMode: "local"
    }),
    state
  );

  await router.handle(
    req("r_run_metrics_2", "agent.run", {
      idempotencyKey: "idem_run_metrics_2",
      sessionId: "s_default",
      input: "run [[tool:unknown.tool {\"x\":1}]]",
      runtimeMode: "local"
    }),
    state
  );

  const summary = await router.handle(req("r_metrics", "metrics.summary", {}), state);
  assert.equal(summary.response.ok, true);
  if (summary.response.ok) {
    const metrics = summary.response.payload.metrics;
    assert.equal(typeof metrics.runsTotal, "number");
    assert.equal(typeof metrics.runsFailed, "number");
    assert.equal(typeof metrics.toolCallsTotal, "number");
    assert.equal(typeof metrics.toolFailures, "number");
    assert.equal(typeof metrics.p95LatencyMs, "number");
    assert.equal(metrics.runsTotal >= 2, true);
    assert.equal(metrics.runsFailed >= 1, true);
  }
});

test("metrics.summary supports tenant/workspace/agent scope filters", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  await router.handle(
    req("r_run_scope_1", "agent.run", {
      idempotencyKey: "idem_run_scope_1",
      sessionId: "s_default",
      input: "scope one",
      runtimeMode: "local",
      tenantId: "t_scope",
      workspaceId: "w_scope",
      agentId: "a_scope"
    }),
    state
  );

  await router.handle(
    req("r_run_scope_2", "agent.run", {
      idempotencyKey: "idem_run_scope_2",
      sessionId: "s_default",
      input: "scope two",
      runtimeMode: "local",
      tenantId: "t_other",
      workspaceId: "w_other",
      agentId: "a_other"
    }),
    state
  );

  const scoped = await router.handle(
    req("r_metrics_scope", "metrics.summary", {
      tenantId: "t_scope",
      workspaceId: "w_scope",
      agentId: "a_scope"
    }),
    state
  );
  assert.equal(scoped.response.ok, true);
  if (scoped.response.ok) {
    const metrics = scoped.response.payload.metrics;
    assert.equal(metrics.runsTotal >= 1, true);
  }
});

test("memory.get and memory.appendDaily are available via gateway route", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const append = await router.handle(
    req("r_memory_append", "memory.appendDaily", {
      idempotencyKey: "idem_memory_append_1",
      date: "2026-02-13",
      content: "memory api smoke test",
      includeLongTerm: true
    }),
    state
  );
  assert.equal(append.response.ok, true);
  if (append.response.ok) {
    assert.equal(append.response.payload.result.path, ".openfoal/memory/daily/2026-02-13.md");
  }

  const getDaily = await router.handle(
    req("r_memory_get", "memory.get", {
      path: ".openfoal/memory/daily/2026-02-13.md"
    }),
    state
  );
  assert.equal(getDaily.response.ok, true);
  if (getDaily.response.ok) {
    const text = getDaily.response.payload.memory?.text ?? "";
    assert.match(String(text), /memory api smoke test/);
  }

  const search = await router.handle(
    req("r_memory_search", "memory.search", {
      query: "smoke test",
      maxResults: 5
    }),
    state
  );
  assert.equal(search.response.ok, true);
  if (search.response.ok) {
    const results = search.response.payload.search?.results;
    assert.equal(Array.isArray(results), true);
    assert.equal((results?.length ?? 0) > 0, true);
    assert.equal(typeof results?.[0]?.path, "string");
  }
});

test("memory.archive moves daily content and clears daily file", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const append = await router.handle(
    req("r_memory_append_2", "memory.appendDaily", {
      idempotencyKey: "idem_memory_append_2",
      date: "2026-02-14",
      content: "archive this memory",
      includeLongTerm: false
    }),
    state
  );
  assert.equal(append.response.ok, true);

  const archive = await router.handle(
    req("r_memory_archive_1", "memory.archive", {
      idempotencyKey: "idem_memory_archive_1",
      date: "2026-02-14",
      includeLongTerm: true,
      clearDaily: true
    }),
    state
  );
  assert.equal(archive.response.ok, true);
  if (archive.response.ok) {
    assert.equal(archive.response.payload.result.date, "2026-02-14");
    assert.equal(archive.response.payload.result.clearDaily, true);
    assert.equal(archive.response.payload.result.dailyPath, ".openfoal/memory/daily/2026-02-14.md");
  }

  const daily = await router.handle(
    req("r_memory_get_daily_cleared", "memory.get", {
      path: ".openfoal/memory/daily/2026-02-14.md"
    }),
    state
  );
  assert.equal(daily.response.ok, true);
  if (daily.response.ok) {
    assert.equal(String(daily.response.payload.memory?.text ?? ""), "");
  }

  const globalMemory = await router.handle(
    req("r_memory_get_global_archived", "memory.get", {
      path: ".openfoal/memory/MEMORY.md"
    }),
    state
  );
  assert.equal(globalMemory.response.ok, true);
  if (globalMemory.response.ok) {
    assert.match(String(globalMemory.response.payload.memory?.text ?? ""), /archive this memory/);
  }
});

test("memory.archive falls back to legacy daily path and returns new canonical path", async () => {
  const writes = [];
  const router = createGatewayRouter({
    internalToolExecutor: {
      async execute(call) {
        if (call.name === "file.read") {
          if (call.args.path === ".openfoal/memory/daily/2026-02-14.md") {
            return {
              ok: false,
              error: {
                code: "TOOL_EXEC_FAILED",
                message: "ENOENT: new path missing"
              }
            };
          }
          if (call.args.path === "memory/2026-02-14.md") {
            return {
              ok: true,
              output: "- legacy archived line\n"
            };
          }
          return {
            ok: false,
            error: {
              code: "TOOL_EXEC_FAILED",
              message: "ENOENT: unexpected path"
            }
          };
        }
        if (call.name === "file.write") {
          writes.push(String(call.args.path ?? ""));
          return {
            ok: true,
            output: ""
          };
        }
        return {
          ok: false,
          error: {
            code: "TOOL_EXEC_FAILED",
            message: "unsupported call"
          }
        };
      }
    }
  });
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const archive = await router.handle(
    req("r_memory_archive_legacy_fallback", "memory.archive", {
      idempotencyKey: "idem_memory_archive_legacy_fallback_1",
      date: "2026-02-14",
      includeLongTerm: true,
      clearDaily: true
    }),
    state
  );
  assert.equal(archive.response.ok, true);
  if (archive.response.ok) {
    assert.equal(archive.response.payload.result.dailyPath, ".openfoal/memory/daily/2026-02-14.md");
  }
  assert.equal(writes.includes(".openfoal/memory/MEMORY.md"), true);
  assert.equal(writes.includes(".openfoal/memory/daily/2026-02-14.md"), true);
  assert.equal(writes.includes("memory/2026-02-14.md"), true);
});
