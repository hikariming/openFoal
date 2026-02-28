import test from "node:test";
import assert from "node:assert/strict";

import { createConnectionState, createGatewayRouter } from "../../apps/gateway/dist/index.js";
import { InMemoryTranscriptRepository } from "../../packages/storage/dist/index.js";

function req(id, method, params = {}) {
  return {
    type: "req",
    id,
    method,
    params
  };
}

test("agent.run emits agent.delta payload.delta", async () => {
  const router = createGatewayRouter();
  const state = createConnectionState();
  await router.handle(req("r_connect_delta_payload", "connect", {}), state);

  const run = await router.handle(
    req("r_run_delta_payload", "agent.run", {
      idempotencyKey: "idem_delta_payload_1",
      sessionId: "s_delta_payload",
      input: "check delta payload",
      runtimeMode: "local"
    }),
    state
  );

  assert.equal(run.response.ok, true);
  const deltaEvent = run.events.find((event) => event.event === "agent.delta");
  assert.ok(deltaEvent, "expected at least one agent.delta event");
  assert.equal(typeof deltaEvent?.payload?.delta, "string");
  assert.equal((deltaEvent?.payload?.delta ?? "").length > 0, true);
});

test("sessions.history normalizes legacy agent.delta payload.text", async () => {
  const transcriptRepo = new InMemoryTranscriptRepository();
  const router = createGatewayRouter({
    transcriptRepo
  });
  const state = createConnectionState();
  await router.handle(req("r_connect_legacy_delta", "connect", {}), state);

  const created = await router.handle(
    req("r_create_legacy_delta_session", "sessions.create", {
      idempotencyKey: "idem_create_legacy_delta_session_1",
      title: "legacy-delta"
    }),
    state
  );
  assert.equal(created.response.ok, true);
  if (!created.response.ok) {
    return;
  }

  const session = created.response.payload.session;
  await transcriptRepo.append({
    sessionId: session.id,
    tenantId: session.tenantId,
    workspaceId: session.workspaceId,
    ownerUserId: session.ownerUserId,
    runId: "run_legacy_delta",
    event: "agent.delta",
    payload: {
      runId: "run_legacy_delta",
      text: "legacy delta from transcript"
    }
  });

  const history = await router.handle(
    req("r_history_legacy_delta", "sessions.history", {
      sessionId: session.id,
      limit: 100
    }),
    state
  );

  assert.equal(history.response.ok, true);
  if (!history.response.ok) {
    return;
  }
  const items = history.response.payload.items;
  const deltaItem = items.find((item) => item.event === "agent.delta" && item.runId === "run_legacy_delta");
  assert.ok(deltaItem, "expected legacy agent.delta item");
  assert.equal(deltaItem?.payload?.delta, "legacy delta from transcript");
});
