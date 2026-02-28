import { createServer } from "node:http";
import * as fs from "node:fs";
import os from "node:os";
import { relative as relativePath } from "node:path";
import { MinioBlobStore, RedisLeaseIndex, syncLocalDirectoryToMinio } from "../packages/storage/dist/index.js";
import { createLocalToolExecutor } from "../packages/tool-executor/dist/index.js";

const host = process.env.ORCHESTRATOR_HOST ?? "0.0.0.0";
const port = Number(process.env.ORCHESTRATOR_PORT ?? "8082");
const authToken = process.env.ORCHESTRATOR_AUTH_TOKEN ?? process.env.RUNNER_AUTH_TOKEN ?? "";
const storageRoot = process.env.ORCHESTRATOR_WORKSPACE_ROOT ?? process.env.RUNNER_WORKSPACE_ROOT ?? "/workspace";
const defaultTimeoutMs = Number(process.env.ORCHESTRATOR_DEFAULT_TIMEOUT_MS ?? process.env.RUNNER_DEFAULT_TIMEOUT_MS ?? "15000");
const bashShell = process.env.ORCHESTRATOR_BASH_SHELL ?? process.env.RUNNER_BASH_SHELL ?? "/bin/sh";
const idleTtlSec = Number(process.env.ORCHESTRATOR_IDLE_TTL_SEC ?? "900");
const maxTtlSec = Number(process.env.ORCHESTRATOR_MAX_TTL_SEC ?? "7200");
const blobBackend = (process.env.ORCHESTRATOR_BLOB_BACKEND ?? process.env.OPENFOAL_BLOB_BACKEND ?? "fs").trim().toLowerCase();
const redisUrl = process.env.ORCHESTRATOR_REDIS_URL ?? process.env.OPENFOAL_REDIS_URL ?? "";

const minioStore =
  blobBackend === "minio"
    ? new MinioBlobStore({
        endpoint: process.env.ORCHESTRATOR_MINIO_ENDPOINT ?? process.env.OPENFOAL_MINIO_ENDPOINT,
        region: process.env.ORCHESTRATOR_MINIO_REGION ?? process.env.OPENFOAL_MINIO_REGION,
        accessKeyId: process.env.ORCHESTRATOR_MINIO_ACCESS_KEY ?? process.env.OPENFOAL_MINIO_ACCESS_KEY,
        secretAccessKey: process.env.ORCHESTRATOR_MINIO_SECRET_KEY ?? process.env.OPENFOAL_MINIO_SECRET_KEY,
        bucket: process.env.ORCHESTRATOR_MINIO_BUCKET ?? process.env.OPENFOAL_MINIO_BUCKET
      })
    : null;
const leaseIndex = redisUrl
  ? new RedisLeaseIndex({
      redisUrl,
      keyPrefix: "openfoal:lease"
    })
  : null;

const leases = new Map();
let lastCpuSnapshot = readCpuSnapshot();

const server = createServer(async (req, res) => {
  try {
    const method = String(req.method ?? "").toUpperCase();
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (method === "GET" && url.pathname === "/health") {
      const usage = readResourceUsage(storageRoot);
      writeJson(res, 200, {
        ok: true,
        service: "sandbox-orchestrator",
        storageRoot,
        leases: leases.size,
        blobBackend,
        redisLeaseIndex: Boolean(leaseIndex),
        usage,
        time: new Date().toISOString()
      });
      return;
    }

    if (method !== "POST" || url.pathname !== "/execute") {
      writeJson(res, 404, {
        error: "NOT_FOUND"
      });
      return;
    }

    if (!isAuthorized(req.headers.authorization, authToken)) {
      writeJson(res, 401, {
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "orchestrator token is invalid"
        }
      });
      return;
    }

    const body = await readJsonBody(req);
    if (!isObjectRecord(body)) {
      writeJson(res, 400, {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "request body must be an object"
        }
      });
      return;
    }

    const call = isObjectRecord(body.call) ? body.call : {};
    const name = typeof call.name === "string" ? call.name.trim() : "";
    const args = isObjectRecord(call.args) ? call.args : {};
    if (!name) {
      writeJson(res, 400, {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "call.name is required"
        }
      });
      return;
    }

    const ctx = isObjectRecord(body.ctx) ? body.ctx : {};
    const target = isObjectRecord(body.target) ? body.target : {};
    const runId = asNonEmptyString(ctx.runId) ?? `run_${Date.now()}`;
    const sessionId = asNonEmptyString(ctx.sessionId) ?? "session_default";
    const runtimeMode = ctx.runtimeMode === "cloud" ? "cloud" : "local";
    const toolCallId = asNonEmptyString(ctx.toolCallId);
    const tenantId = sanitizeSegment(asNonEmptyString(ctx.tenantId) ?? asNonEmptyString(target.tenantId) ?? "t_default");
    const workspaceId = sanitizeSegment(asNonEmptyString(ctx.workspaceId) ?? asNonEmptyString(target.workspaceId) ?? "w_default");
    const userId = sanitizeSegment(asNonEmptyString(ctx.userId) ?? "u_legacy");

    const lease = touchLease({
      tenantId,
      workspaceId,
      userId,
      sessionId: sanitizeSegment(sessionId)
    });
    if (leaseIndex) {
      await leaseIndex.touch(
        {
          tenantId,
          workspaceId,
          userId,
          sessionId: sanitizeSegment(sessionId),
          containerId: process.env.HOSTNAME ?? "sandbox-orchestrator",
          workspaceRoot: lease.workspaceRoot,
          createdAt: lease.createdAt,
          lastSeenAt: lease.lastSeenAt
        },
        idleTtlSec
      );
    }

    const toolExecutor = createLocalToolExecutor({
      workspaceRoot: lease.workspaceRoot,
      bashShell,
      defaultTimeoutMs: Number.isFinite(defaultTimeoutMs) && defaultTimeoutMs > 0 ? defaultTimeoutMs : 15000
    });
    const updates = [];
    const result = await toolExecutor.execute(
      {
        name,
        args
      },
      {
        runId,
        sessionId,
        runtimeMode,
        tenantId,
        workspaceId,
        userId,
        workspaceRoot: lease.workspaceRoot,
        ...(toolCallId ? { toolCallId } : {})
      },
      {
        onUpdate: (update) => {
          updates.push(update);
        }
      }
    );

    let blobSync;
    if (minioStore) {
      const relativeRoot = toPosixPath(relativePath(storageRoot, lease.workspaceRoot));
      const keyPrefix = sanitizeObjectPrefix(relativeRoot.length > 0 && relativeRoot !== "." ? relativeRoot : "");
      blobSync = await syncLocalDirectoryToMinio({
        localRoot: lease.workspaceRoot,
        keyPrefix,
        store: minioStore
      });
    }

    writeJson(res, 200, {
      lease: {
        key: lease.key,
        workspaceRoot: lease.workspaceRoot,
        createdAt: lease.createdAt,
        lastSeenAt: lease.lastSeenAt
      },
      ...(blobSync ? { blobSync } : {}),
      updates,
      result
    });
  } catch (error) {
    writeJson(res, 500, {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error)
      }
    });
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, host, () => resolve());
});

console.log(`[sandbox-orchestrator] listening on http://${host}:${String(port)}`);

const shutdown = async () => {
  await new Promise((resolve) => server.close(() => resolve()));
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

function touchLease(input) {
  const now = Date.now();
  const key = [input.tenantId, input.workspaceId, input.userId, input.sessionId].join("::");
  const existing = leases.get(key);
  if (existing) {
    const idleMs = now - existing.lastSeenMs;
    const maxMs = now - existing.createdMs;
    if (idleMs <= idleTtlSec * 1000 && maxMs <= maxTtlSec * 1000) {
      existing.lastSeenMs = now;
      existing.lastSeenAt = new Date(now).toISOString();
      return existing;
    }
  }
  const workspaceRoot = [
    storageRoot,
    "tenants",
    input.tenantId,
    "workspaces",
    input.workspaceId,
    "users",
    input.userId,
    "sessions",
    input.sessionId
  ].join("/");
  const created = {
    key,
    workspaceRoot,
    createdMs: now,
    lastSeenMs: now,
    createdAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString()
  };
  fs.mkdirSync(workspaceRoot, { recursive: true });
  leases.set(key, created);
  return created;
}

function isAuthorized(rawAuth, token) {
  if (!token) {
    return true;
  }
  if (typeof rawAuth !== "string") {
    return false;
  }
  const normalized = rawAuth.trim();
  return normalized === `Bearer ${token}`;
}

async function readJsonBody(req) {
  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on("data", (chunk) => {
      chunks.push(chunk);
    });
    req.on("end", resolve);
    req.on("error", reject);
  });
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  return JSON.parse(text);
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", String(Buffer.byteLength(body)));
  res.end(body);
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function sanitizeSegment(value) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function toPosixPath(value) {
  return String(value ?? "").replace(/\\\\/g, "/");
}

function sanitizeObjectPrefix(value) {
  return String(value ?? "")
    .replace(/\.\./g, "_")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

function readResourceUsage(targetPath) {
  return {
    cpuPercent: readCpuPercent(),
    memoryPercent: readMemoryPercent(),
    diskPercent: readDiskPercent(targetPath)
  };
}

function readCpuSnapshot() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

function readCpuPercent() {
  const next = readCpuSnapshot();
  const prev = lastCpuSnapshot;
  lastCpuSnapshot = next;
  if (!prev) {
    return 0;
  }
  const idleDelta = next.idle - prev.idle;
  const totalDelta = next.total - prev.total;
  if (!Number.isFinite(totalDelta) || totalDelta <= 0) {
    return 0;
  }
  const usage = 1 - idleDelta / totalDelta;
  return roundPercent(usage * 100);
}

function readMemoryPercent() {
  const total = os.totalmem();
  const free = os.freemem();
  if (!Number.isFinite(total) || total <= 0) {
    return 0;
  }
  const used = Math.max(0, total - free);
  return roundPercent((used / total) * 100);
}

function readDiskPercent(targetPath) {
  if (typeof fs.statfsSync !== "function") {
    return 0;
  }
  try {
    const stat = fs.statfsSync(targetPath);
    const bsize = Number(stat.bsize);
    const blocks = Number(stat.blocks);
    const bfree = Number(stat.bfree);
    if (!Number.isFinite(bsize) || !Number.isFinite(blocks) || !Number.isFinite(bfree) || blocks <= 0 || bsize <= 0) {
      return 0;
    }
    const total = blocks * bsize;
    const used = Math.max(0, (blocks - bfree) * bsize);
    return roundPercent((used / total) * 100);
  } catch {
    return 0;
  }
}

function roundPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const clamped = Math.max(0, Math.min(100, value));
  return Number(clamped.toFixed(1));
}
