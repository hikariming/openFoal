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

test("approval.queue/approval.resolve closes approval-required tool run", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const runPromise = router.handle(
    req("r_run_need_approval", "agent.run", {
      idempotencyKey: "idem_run_need_approval_1",
      sessionId: "s_default",
      input: "run [[tool:bash.exec {\"cmd\":\"echo approval-flow\"}]]",
      runtimeMode: "local"
    }),
    state
  );

  const pending = await waitForPendingApproval(router, state);
  const resolved = await router.handle(
    req("r_approval_resolve", "approval.resolve", {
      idempotencyKey: "idem_approval_resolve_1",
      approvalId: pending.approvalId,
      decision: "approve",
      reason: "allow for test"
    }),
    state
  );
  assert.equal(resolved.response.ok, true);
  if (resolved.response.ok) {
    assert.equal(resolved.response.payload.approval.approvalId, pending.approvalId);
    assert.equal(resolved.response.payload.approval.status, "approved");
  }

  const run = await runPromise;
  assert.equal(run.response.ok, true);
  assert.equal(run.events.some((event) => event.event === "approval.required"), true);
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

async function waitForPendingApproval(router, state) {
  for (let i = 0; i < 60; i += 1) {
    const queued = await router.handle(req(`r_approval_queue_${i}`, "approval.queue", { status: "pending" }), state);
    if (queued.response.ok) {
      const first = queued.response.payload.items[0];
      if (first) {
        return first;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("pending approval not found");
}
