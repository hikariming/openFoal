import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  SqliteIdempotencyRepository,
  SqliteSessionRepository,
  SqliteTranscriptRepository
} from "../../packages/storage/dist/index.js";

test("sqlite session repository persists across instances", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openfoal-storage-"));
  const dbPath = join(dir, "storage.sqlite");

  try {
    const repoA = new SqliteSessionRepository(dbPath);
    const seed = await repoA.list();
    assert.equal(seed.length > 0, true);

    await repoA.upsert({
      id: "s_persist",
      sessionKey: "workspace:w_default/agent:a_default/main:thread:s_persist",
      title: "persisted session",
      preview: "persisted preview",
      runtimeMode: "local",
      syncState: "local_only",
      updatedAt: "2026-02-13T00:00:00.000Z"
    });
    await repoA.setRuntimeMode("s_persist", "cloud");

    const repoB = new SqliteSessionRepository(dbPath);
    const persisted = await repoB.get("s_persist");
    assert.equal(Boolean(persisted), true);
    assert.equal(persisted?.runtimeMode, "cloud");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite session repository migrates old schema with title and preview", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openfoal-storage-migrate-"));
  const dbPath = join(dir, "legacy.sqlite");

  try {
    const setup = spawnSync(
      "sqlite3",
      [
        dbPath,
        `
          CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            session_key TEXT NOT NULL,
            runtime_mode TEXT NOT NULL,
            sync_state TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          INSERT INTO sessions (id, session_key, runtime_mode, sync_state, updated_at)
          VALUES ('s_legacy', 'workspace:w_default/agent:a_default/main', 'local', 'local_only', '2026-02-13T00:00:00.000Z');
        `
      ],
      { encoding: "utf8" }
    );
    assert.equal(setup.status, 0);

    const repo = new SqliteSessionRepository(dbPath);
    const item = await repo.get("s_legacy");
    assert.equal(Boolean(item), true);
    assert.equal(item?.title, "new-session");
    assert.equal(item?.preview, "");

    await repo.upsert({
      id: "s_legacy",
      sessionKey: "workspace:w_default/agent:a_default/main",
      title: "updated title",
      preview: "updated preview",
      runtimeMode: "cloud",
      syncState: "local_only",
      updatedAt: "2026-02-13T00:00:00.000Z"
    });

    const updated = await repo.get("s_legacy");
    assert.equal(updated?.title, "updated title");
    assert.equal(updated?.preview, "updated preview");
    assert.equal(updated?.runtimeMode, "cloud");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite transcript repository persists run events", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openfoal-transcript-"));
  const dbPath = join(dir, "storage.sqlite");

  try {
    const repoA = new SqliteTranscriptRepository(dbPath);
    await repoA.append({
      sessionId: "s_default",
      runId: "run_1",
      event: "agent.delta",
      payload: {
        delta: "hello"
      }
    });
    await repoA.append({
      sessionId: "s_default",
      runId: "run_1",
      event: "agent.completed",
      payload: {
        output: "hello"
      }
    });

    const repoB = new SqliteTranscriptRepository(dbPath);
    const items = await repoB.list("s_default", 20);
    assert.equal(items.length, 2);
    assert.equal(items[0].event, "agent.delta");
    assert.equal(items[1].event, "agent.completed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite idempotency repository persists cached result", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openfoal-idem-"));
  const dbPath = join(dir, "storage.sqlite");

  try {
    const repoA = new SqliteIdempotencyRepository(dbPath);
    await repoA.set("agent.run:s_default:idem_1", {
      fingerprint: "{\"input\":\"hello\"}",
      result: {
        response: {
          type: "res",
          id: "r_1",
          ok: true,
          payload: { runId: "run_1", status: "accepted" }
        },
        events: [{ type: "event", event: "agent.completed", payload: { output: "hello" }, seq: 1, stateVersion: 1 }]
      }
    });

    const repoB = new SqliteIdempotencyRepository(dbPath);
    const cached = await repoB.get("agent.run:s_default:idem_1");
    assert.equal(Boolean(cached), true);
    assert.equal(cached?.fingerprint, "{\"input\":\"hello\"}");
    assert.equal(cached?.result?.response?.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
