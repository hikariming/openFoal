import test from "node:test";
import assert from "node:assert/strict";

import { validateReqFrame } from "../../packages/protocol/dist/index.js";

test("connect request passes validation", () => {
  const result = validateReqFrame({
    type: "req",
    id: "r_connect_1",
    method: "connect",
    params: {
      client: { name: "desktop", version: "0.1.0" }
    }
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.method, "connect");
  }
});

test("side-effect method requires idempotencyKey", () => {
  const result = validateReqFrame({
    type: "req",
    id: "r_run_1",
    method: "agent.run",
    params: {
      sessionId: "s_default",
      input: "hello"
    }
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "INVALID_REQUEST");
  }
});

test("sessions.create requires idempotencyKey", () => {
  const result = validateReqFrame({
    type: "req",
    id: "r_sessions_create_1",
    method: "sessions.create",
    params: {
      title: "new"
    }
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "INVALID_REQUEST");
  }
});

test("memory.appendDaily requires idempotencyKey", () => {
  const result = validateReqFrame({
    type: "req",
    id: "r_memory_append_1",
    method: "memory.appendDaily",
    params: {
      content: "test"
    }
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "INVALID_REQUEST");
  }
});

test("memory.archive requires idempotencyKey", () => {
  const result = validateReqFrame({
    type: "req",
    id: "r_memory_archive_1",
    method: "memory.archive",
    params: {
      date: "2026-02-13"
    }
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "INVALID_REQUEST");
  }
});

test("budget.update requires idempotencyKey", () => {
  const result = validateReqFrame({
    type: "req",
    id: "r_budget_update_1",
    method: "budget.update",
    params: {
      scopeKey: "workspace:t_default:w_default",
      tokenDailyLimit: 10000
    }
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "INVALID_REQUEST");
  }
});

test("unknown method returns METHOD_NOT_FOUND", () => {
  const result = validateReqFrame({
    type: "req",
    id: "r_unknown",
    method: "agent.unknown",
    params: {}
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "METHOD_NOT_FOUND");
  }
});
