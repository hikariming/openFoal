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
