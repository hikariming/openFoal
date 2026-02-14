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

  const getDaily = await router.handle(
    req("r_memory_get", "memory.get", {
      path: "memory/2026-02-13.md"
    }),
    state
  );
  assert.equal(getDaily.response.ok, true);
  if (getDaily.response.ok) {
    const text = getDaily.response.payload.memory?.text ?? "";
    assert.match(String(text), /memory api smoke test/);
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
  }

  const daily = await router.handle(
    req("r_memory_get_daily_cleared", "memory.get", {
      path: "memory/2026-02-14.md"
    }),
    state
  );
  assert.equal(daily.response.ok, true);
  if (daily.response.ok) {
    assert.equal(String(daily.response.payload.memory?.text ?? ""), "");
  }

  const globalMemory = await router.handle(
    req("r_memory_get_global_archived", "memory.get", {
      path: "MEMORY.md"
    }),
    state
  );
  assert.equal(globalMemory.response.ok, true);
  if (globalMemory.response.ok) {
    assert.match(String(globalMemory.response.payload.memory?.text ?? ""), /archive this memory/);
  }
});
