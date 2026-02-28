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

test("P1-CT-001 connect before business methods", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();

  const result = await router.handle(req("r1", "sessions.list", {}), state);
  assert.equal(result.response.ok, false);
  if (!result.response.ok) {
    assert.equal(result.response.error.code, "UNAUTHORIZED");
  }
});

test("P1-CT-002 agent.run idempotency replay and conflict", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const first = await router.handle(
    req("r_run", "agent.run", {
      idempotencyKey: "idem_p1_smoke_run_001",
      sessionId: "s_default",
      input: "hello from p1 smoke",
      runtimeMode: "local"
    }),
    state
  );
  assert.equal(first.response.ok, true);

  const replay = await router.handle(
    req("r_run", "agent.run", {
      idempotencyKey: "idem_p1_smoke_run_001",
      sessionId: "s_default",
      input: "hello from p1 smoke",
      runtimeMode: "local"
    }),
    state
  );
  assert.equal(replay.response.ok, true);

  const conflict = await router.handle(
    req("r_run", "agent.run", {
      idempotencyKey: "idem_p1_smoke_run_001",
      sessionId: "s_default",
      input: "changed payload",
      runtimeMode: "local"
    }),
    state
  );
  assert.equal(conflict.response.ok, false);
  if (!conflict.response.ok) {
    assert.equal(conflict.response.error.code, "IDEMPOTENCY_CONFLICT");
  }
});

test("P1-SM-001 sessions.create and sessions.list", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const created = await router.handle(
    req("r_create", "sessions.create", {
      idempotencyKey: "idem_p1_smoke_session_create_001",
      title: "personal web smoke",
      runtimeMode: "local"
    }),
    state
  );
  assert.equal(created.response.ok, true);

  const listed = await router.handle(req("r_list", "sessions.list", {}), state);
  assert.equal(listed.response.ok, true);
  if (listed.response.ok && created.response.ok) {
    const createdId = created.response.payload.session.id;
    assert.equal(Array.isArray(listed.response.payload.items), true);
    assert.equal(listed.response.payload.items.some((item) => item.id === createdId), true);
  }
});

test("P1-SM-002 agent.run emits stream-compatible events and P1-SM-003 history replay", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const run = await router.handle(
    req("r_run_stream", "agent.run", {
      idempotencyKey: "idem_p1_smoke_stream_001",
      sessionId: "s_default",
      input: "hello stream smoke",
      runtimeMode: "local"
    }),
    state,
    {
      transport: "http"
    }
  );
  assert.equal(run.response.ok, true);
  assert.equal(run.events.some((event) => event.event === "agent.completed"), true);

  const history = await router.handle(
    req("r_history", "sessions.history", {
      sessionId: "s_default",
      limit: 50
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

test("P1-SM-004 POLICY_DENIED path is observable", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect", "connect", {}), state);

  const updatedPolicy = await router.handle(
    req("r_policy_update", "policy.update", {
      idempotencyKey: "idem_p1_smoke_policy_update_001",
      patch: {
        tools: {
          "bash.exec": "deny"
        }
      }
    }),
    state
  );
  assert.equal(updatedPolicy.response.ok, true);

  const deniedRun = await router.handle(
    req("r_denied_run", "agent.run", {
      idempotencyKey: "idem_p1_smoke_denied_run_001",
      sessionId: "s_default",
      input: "run [[tool:bash.exec {\"cmd\":\"echo deny\"}]]",
      runtimeMode: "local"
    }),
    state
  );
  assert.equal(deniedRun.response.ok, true);
  assert.equal(deniedRun.events.some((event) => event.event === "agent.failed"), true);
  const failed = deniedRun.events.find((event) => event.event === "agent.failed");
  assert.equal(failed?.payload?.code, "POLICY_DENIED");
});
