import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createConnectionState, createGatewayRouter } from "../../apps/gateway/dist/index.js";
import {
  SqliteIdempotencyRepository,
  SqliteSessionRepository,
  SqliteTranscriptRepository
} from "../../packages/storage/dist/index.js";

function req(id, method, params = {}) {
  return {
    type: "req",
    id,
    method,
    params
  };
}

test("gateway persists idempotency and transcript in sqlite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openfoal-gateway-persist-"));
  const dbPath = join(dir, "gateway.sqlite");

  try {
    const routerA = createGatewayRouter({
      sessionRepo: new SqliteSessionRepository(dbPath),
      idempotencyRepo: new SqliteIdempotencyRepository(dbPath),
      transcriptRepo: new SqliteTranscriptRepository(dbPath)
    });
    const stateA = createConnectionState();
    await routerA.handle(req("r_connect_a", "connect", {}), stateA);

    const firstRun = await routerA.handle(
      req("r_run_1", "agent.run", {
        idempotencyKey: "idem_persist_1",
        sessionId: "s_default",
        input: "run [[tool:math.add {\"a\": 2, \"b\": 3}]]",
        runtimeMode: "local"
      }),
      stateA
    );
    assert.equal(firstRun.response.ok, true);

    const routerB = createGatewayRouter({
      sessionRepo: new SqliteSessionRepository(dbPath),
      idempotencyRepo: new SqliteIdempotencyRepository(dbPath),
      transcriptRepo: new SqliteTranscriptRepository(dbPath)
    });
    const stateB = createConnectionState();
    await routerB.handle(req("r_connect_b", "connect", {}), stateB);

    const replay = await routerB.handle(
      req("r_run_2", "agent.run", {
        idempotencyKey: "idem_persist_1",
        sessionId: "s_default",
        input: "run [[tool:math.add {\"a\": 2, \"b\": 3}]]",
        runtimeMode: "local"
      }),
      stateB
    );

    assert.deepEqual(replay, firstRun);

    const transcriptRepo = new SqliteTranscriptRepository(dbPath);
    const transcript = await transcriptRepo.list("s_default", 100);
    assert.equal(transcript.length > 0, true);
    assert.equal(transcript.some((item) => item.event === "agent.tool_call_start"), true);
    assert.equal(transcript.some((item) => item.event === "agent.tool_result_start"), true);
    assert.equal(transcript.some((item) => item.event === "agent.completed"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
