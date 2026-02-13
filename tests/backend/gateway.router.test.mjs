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
