import test from "node:test";
import assert from "node:assert/strict";

import { createRuntimeCoreService } from "../../packages/core/dist/index.js";

test("core runtime emits accepted/delta/completed for plain input", async () => {
  const core = createRuntimeCoreService();
  const events = [];

  for await (const event of core.run({
    sessionId: "s_default",
    input: "hello runtime",
    runtimeMode: "local"
  })) {
    events.push(event);
  }

  assert.equal(events[0]?.type, "accepted");
  assert.equal(events.some((event) => event.type === "delta"), true);
  assert.equal(events.at(-1)?.type, "completed");
});

test("core runtime executes tool loop directives", async () => {
  const core = createRuntimeCoreService();
  const events = [];

  for await (const event of core.run({
    sessionId: "s_default",
    input: "sum [[tool:math.add {\"a\": 2, \"b\": 3}]]",
    runtimeMode: "local"
  })) {
    events.push(event);
  }

  const eventTypes = events.map((event) => event.type);
  assert.equal(eventTypes.includes("tool_call"), true);
  assert.equal(eventTypes.includes("tool_result"), true);
  assert.equal(eventTypes.includes("completed"), true);

  const toolCall = events.find((event) => event.type === "tool_call");
  assert.equal(toolCall?.toolName, "math.add");

  const toolResult = events.find((event) => event.type === "tool_result");
  assert.equal(toolResult?.output, "5");

  const completed = events.find((event) => event.type === "completed");
  assert.equal(typeof completed?.output, "string");
  assert.match(completed.output, /5/);
});

test("core runtime stops run when aborted", async () => {
  const core = createRuntimeCoreService({
    toolExecutor: {
      async execute() {
        await sleep(10);
        return { ok: true, output: "will-not-be-used" };
      }
    }
  });

  const events = [];

  for await (const event of core.run({
    sessionId: "s_default",
    input: "[[tool:text.upper {\"text\": \"openfoal\"}]]",
    runtimeMode: "local"
  })) {
    events.push(event);
    if (event.type === "accepted") {
      await core.abort(event.runId);
    }
  }

  const failed = events.find((event) => event.type === "failed");
  assert.equal(Boolean(failed), true);
  assert.equal(failed?.code, "ABORTED");
});

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
