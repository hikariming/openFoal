import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  SqliteAgentRepository,
  SqliteAuditRepository,
  SqliteBudgetRepository,
  SqliteExecutionTargetRepository,
  SqliteIdempotencyRepository,
  SqliteMetricsRepository,
  SqlitePolicyRepository,
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
      contextUsage: 0.2,
      compactionCount: 1,
      memoryFlushState: "idle",
      updatedAt: "2026-02-13T00:00:00.000Z"
    });
    await repoA.setRuntimeMode("s_persist", "cloud");
    await repoA.updateMeta("s_persist", {
      contextUsage: 0.73,
      compactionCount: 3,
      memoryFlushState: "flushed",
      memoryFlushAt: "2026-02-13T12:00:00.000Z"
    });

    const repoB = new SqliteSessionRepository(dbPath);
    const persisted = await repoB.get("s_persist");
    assert.equal(Boolean(persisted), true);
    assert.equal(persisted?.runtimeMode, "cloud");
    assert.equal(persisted?.contextUsage, 0.73);
    assert.equal(persisted?.compactionCount, 3);
    assert.equal(persisted?.memoryFlushState, "flushed");
    assert.equal(persisted?.memoryFlushAt, "2026-02-13T12:00:00.000Z");
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
      contextUsage: 0.11,
      compactionCount: 2,
      memoryFlushState: "idle",
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

test("sqlite policy/metrics repositories persist across instances", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openfoal-storage-extra-"));
  const dbPath = join(dir, "storage.sqlite");

  try {
    const policyA = new SqlitePolicyRepository(dbPath);
    const current = await policyA.get();
    const updated = await policyA.update({
      toolDefault: "allow",
      tools: {
        "bash.exec": "allow"
      }
    });
    assert.equal(updated.version > current.version, true);
    assert.equal(updated.toolDefault, "allow");

    const metricsA = new SqliteMetricsRepository(dbPath);
    await metricsA.recordRun({
      sessionId: "s_default",
      runId: "run_repo_1",
      status: "completed",
      durationMs: 120,
      toolCalls: 2,
      toolFailures: 0
    });
    await metricsA.recordRun({
      sessionId: "s_default",
      runId: "run_repo_2",
      status: "failed",
      durationMs: 300,
      toolCalls: 1,
      toolFailures: 1
    });

    const policyB = new SqlitePolicyRepository(dbPath);
    const metricsB = new SqliteMetricsRepository(dbPath);

    const persistedPolicy = await policyB.get();
    const summary = await metricsB.summary();

    assert.equal(persistedPolicy.toolDefault, "allow");
    assert.equal(summary.runsTotal, 2);
    assert.equal(summary.runsFailed, 1);
    assert.equal(summary.toolCallsTotal, 3);
    assert.equal(summary.toolFailures, 1);
    assert.equal(summary.p95LatencyMs >= 120, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite p2 repositories persist agents/targets/budget/audit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openfoal-storage-p2-"));
  const dbPath = join(dir, "storage.sqlite");

  try {
    const agentsA = new SqliteAgentRepository(dbPath);
    const targetsA = new SqliteExecutionTargetRepository(dbPath);
    const budgetA = new SqliteBudgetRepository(dbPath);
    const auditA = new SqliteAuditRepository(dbPath);

    const target = await targetsA.upsert({
      targetId: "target_docker_ops",
      tenantId: "t_ops",
      workspaceId: "w_ops",
      kind: "docker-runner",
      endpoint: "http://runner.internal",
      isDefault: true,
      enabled: true,
      config: {
        timeoutMs: 5000
      }
    });
    assert.equal(target.kind, "docker-runner");
    assert.equal(target.isDefault, true);

    const agent = await agentsA.upsert({
      tenantId: "t_ops",
      workspaceId: "w_ops",
      agentId: "a_support",
      name: "support",
      runtimeMode: "cloud",
      executionTargetId: target.targetId,
      enabled: true,
      config: {
        model: "gpt-4o-mini"
      }
    });
    assert.equal(agent.executionTargetId, "target_docker_ops");

    const policy = await budgetA.update(
      {
        tokenDailyLimit: 1000,
        costMonthlyUsdLimit: 30,
        hardLimit: true
      },
      "workspace:t_ops:w_ops"
    );
    assert.equal(policy.tokenDailyLimit, 1000);
    assert.equal(policy.costMonthlyUsdLimit, 30);

    await budgetA.addUsage({
      scopeKey: "workspace:t_ops:w_ops",
      date: "2026-02-14",
      tokensUsed: 400,
      costUsd: 2.5
    });
    await budgetA.addUsage({
      scopeKey: "workspace:t_ops:w_ops",
      date: "2026-02-14",
      runsRejected: 1
    });

    await auditA.append({
      tenantId: "t_ops",
      workspaceId: "w_ops",
      action: "budget.rejected",
      actor: "tester",
      resourceType: "budget_policy",
      resourceId: "workspace:t_ops:w_ops",
      metadata: {
        reason: "tokenDailyLimit(1000)"
      }
    });

    const agentsB = new SqliteAgentRepository(dbPath);
    const targetsB = new SqliteExecutionTargetRepository(dbPath);
    const budgetB = new SqliteBudgetRepository(dbPath);
    const auditB = new SqliteAuditRepository(dbPath);

    const persistedAgent = await agentsB.get("t_ops", "w_ops", "a_support");
    assert.equal(Boolean(persistedAgent), true);
    assert.equal(persistedAgent?.executionTargetId, "target_docker_ops");

    const defaults = await targetsB.findDefault("t_ops", "w_ops");
    assert.equal(defaults?.targetId, "target_docker_ops");

    const summary = await budgetB.summary("workspace:t_ops:w_ops", "2026-02-14");
    assert.equal(summary.tokensUsedDaily, 400);
    assert.equal(summary.runsRejectedDaily, 1);
    assert.equal(summary.costUsdMonthly >= 2.5, true);

    const queried = await auditB.query({
      tenantId: "t_ops",
      workspaceId: "w_ops",
      action: "budget.rejected",
      limit: 20
    });
    assert.equal(Array.isArray(queried.items), true);
    assert.equal(queried.items.length >= 1, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
