import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createLocalToolExecutor } from "../../packages/tool-executor/dist/index.js";

const TOOL_CTX = {
  runId: "run_test",
  sessionId: "s_test",
  runtimeMode: "local"
};

test("tool executor supports bash.exec", async () => {
  const executor = createLocalToolExecutor();
  const updates = [];
  const result = await executor.execute(
    {
      name: "bash.exec",
      args: {
        cmd: "for i in 1 2 3; do printf \"hello-tool-exec-$i\\n\"; sleep 0.01; done"
      }
    },
    TOOL_CTX,
    {
      onUpdate: (update) => {
        updates.push(update.delta);
      }
    }
  );

  assert.equal(result.ok, true);
  assert.match(result.output ?? "", /hello-tool-exec-1/);
  assert.equal(updates.length >= 2, true);
});

test("tool executor supports file.write/file.read/file.list", async () => {
  const root = mkdtempSync(join(tmpdir(), "openfoal-tool-file-"));
  const executor = createLocalToolExecutor({
    workspaceRoot: root
  });

  try {
    const writeResult = await executor.execute(
      {
        name: "file.write",
        args: {
          path: "notes/today.txt",
          content: "hello-file-driver"
        }
      },
      TOOL_CTX
    );
    assert.equal(writeResult.ok, true);

    const readResult = await executor.execute(
      {
        name: "file.read",
        args: {
          path: "notes/today.txt"
        }
      },
      TOOL_CTX
    );
    assert.equal(readResult.ok, true);
    assert.equal(readResult.output, "hello-file-driver");

    const listResult = await executor.execute(
      {
        name: "file.list",
        args: {
          path: "notes"
        }
      },
      TOOL_CTX
    );
    assert.equal(listResult.ok, true);
    assert.match(listResult.output, /today\.txt/);

    const content = readFileSync(join(root, "notes/today.txt"), "utf8");
    assert.equal(content, "hello-file-driver");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tool executor supports memory.get/memory.appendDaily", async () => {
  const root = mkdtempSync(join(tmpdir(), "openfoal-tool-memory-"));
  const executor = createLocalToolExecutor({
    workspaceRoot: root
  });

  try {
    const append = await executor.execute(
      {
        name: "memory.appendDaily",
        args: {
          date: "2026-02-13",
          content: "remember this item",
          includeLongTerm: true
        }
      },
      TOOL_CTX
    );
    assert.equal(append.ok, true);

    const getDaily = await executor.execute(
      {
        name: "memory.get",
        args: {
          path: ".openfoal/memory/daily/2026-02-13.md"
        }
      },
      TOOL_CTX
    );
    assert.equal(getDaily.ok, true);
    if (getDaily.ok) {
      const payload = JSON.parse(getDaily.output ?? "{}");
      assert.match(payload.text ?? "", /remember this item/);
    }

    const getLongTerm = await executor.execute(
      {
        name: "memory.get",
        args: {
          path: ".openfoal/memory/MEMORY.md"
        }
      },
      TOOL_CTX
    );
    assert.equal(getLongTerm.ok, true);
    if (getLongTerm.ok) {
      const payload = JSON.parse(getLongTerm.output ?? "{}");
      assert.match(payload.text ?? "", /remember this item/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tool executor memory.get falls back to legacy memory paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "openfoal-tool-memory-legacy-"));
  const executor = createLocalToolExecutor({
    workspaceRoot: root
  });
  try {
    mkdirSync(join(root, "memory"), { recursive: true });
    writeFileSync(join(root, "memory", "2026-02-20.md"), "- legacy memory entry\n", "utf8");

    const readResult = await executor.execute(
      {
        name: "memory.get",
        args: {
          path: ".openfoal/memory/daily/2026-02-20.md"
        }
      },
      TOOL_CTX
    );
    assert.equal(readResult.ok, true);
    if (readResult.ok) {
      const payload = JSON.parse(readResult.output ?? "{}");
      assert.equal(payload.path, ".openfoal/memory/daily/2026-02-20.md");
      assert.match(String(payload.text ?? ""), /legacy memory entry/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tool executor supports memory.search without embedding keys", async () => {
  const root = mkdtempSync(join(tmpdir(), "openfoal-tool-memory-search-"));
  const executor = createLocalToolExecutor({
    workspaceRoot: root
  });

  try {
    const append = await executor.execute(
      {
        name: "memory.appendDaily",
        args: {
          date: "2026-02-13",
          content: "project alpha decision log",
          includeLongTerm: true
        }
      },
      TOOL_CTX
    );
    assert.equal(append.ok, true);

    const search = await executor.execute(
      {
        name: "memory.search",
        args: {
          query: "alpha decision",
          maxResults: 5
        }
      },
      TOOL_CTX
    );
    assert.equal(search.ok, true);
    if (search.ok) {
      const payload = JSON.parse(search.output ?? "{}");
      assert.equal(Array.isArray(payload.results), true);
      assert.equal(payload.mode === "keyword" || payload.mode === "contains" || payload.mode === "hybrid", true);
      assert.equal((payload.results?.length ?? 0) > 0, true);
      assert.equal(typeof payload.results?.[0]?.path, "string");
      assert.equal(typeof payload.results?.[0]?.startLine, "number");
      assert.equal(typeof payload.results?.[0]?.score, "number");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tool executor memory.get rejects non-whitelisted path", async () => {
  const root = mkdtempSync(join(tmpdir(), "openfoal-tool-memory-safe-"));
  const executor = createLocalToolExecutor({
    workspaceRoot: root
  });
  try {
    const result = await executor.execute(
      {
        name: "memory.get",
        args: {
          path: "../etc/passwd"
        }
      },
      TOOL_CTX
    );
    assert.equal(result.ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tool executor supports http.request", async (t) => {
  const server = createHttpServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, service: "tool-http-test" }));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  try {
    await listen(server);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EPERM") {
      t.skip("sandbox does not allow binding localhost");
      return;
    }
    throw error;
  }

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const executor = createLocalToolExecutor();

  try {
    const result = await executor.execute(
      {
        name: "http.request",
        args: {
          url: `http://127.0.0.1:${port}/health`,
          method: "GET"
        }
      },
      TOOL_CTX
    );

    assert.equal(result.ok, true);
    const payload = JSON.parse(result.output ?? "{}");
    assert.equal(payload.statusCode, 200);
    assert.equal(typeof payload.body, "string");
    assert.match(payload.body, /tool-http-test/);
  } finally {
    await close(server);
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
