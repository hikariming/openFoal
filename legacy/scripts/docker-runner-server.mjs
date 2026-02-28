import { createServer } from "node:http";
import * as fs from "node:fs";
import os from "node:os";
import { createLocalToolExecutor } from "../packages/tool-executor/dist/index.js";

const host = process.env.RUNNER_HOST ?? "0.0.0.0";
const port = Number(process.env.RUNNER_PORT ?? "8081");
const authToken = process.env.RUNNER_AUTH_TOKEN ?? "";
const workspaceRoot = process.env.RUNNER_WORKSPACE_ROOT ?? "/workspace";
const defaultTimeoutMs = Number(process.env.RUNNER_DEFAULT_TIMEOUT_MS ?? "15000");

const toolExecutor = createLocalToolExecutor({
  workspaceRoot,
  defaultTimeoutMs: Number.isFinite(defaultTimeoutMs) && defaultTimeoutMs > 0 ? defaultTimeoutMs : 15000
});
let lastCpuSnapshot = readCpuSnapshot();

const server = createServer(async (req, res) => {
  try {
    const method = String(req.method ?? "").toUpperCase();
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (method === "GET" && url.pathname === "/health") {
      const usage = readResourceUsage(workspaceRoot);
      writeJson(res, 200, {
        ok: true,
        service: "docker-runner",
        workspaceRoot,
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
          message: "runner token is invalid"
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
    const runId = typeof ctx.runId === "string" && ctx.runId.trim().length > 0 ? ctx.runId.trim() : `run_${Date.now()}`;
    const sessionId =
      typeof ctx.sessionId === "string" && ctx.sessionId.trim().length > 0 ? ctx.sessionId.trim() : "session_default";
    const runtimeMode = ctx.runtimeMode === "cloud" ? "cloud" : "local";
    const toolCallId = typeof ctx.toolCallId === "string" && ctx.toolCallId.trim().length > 0 ? ctx.toolCallId.trim() : undefined;

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
        ...(toolCallId ? { toolCallId } : {})
      },
      {
        onUpdate: (update) => {
          updates.push(update);
        }
      }
    );

    writeJson(res, 200, {
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

console.log(`[docker-runner] listening on http://${host}:${String(port)}`);

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
