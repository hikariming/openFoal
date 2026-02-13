import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  const result = await executor.execute(
    {
      name: "bash.exec",
      args: {
        cmd: "printf 'hello-tool-exec'"
      }
    },
    TOOL_CTX
  );

  assert.equal(result.ok, true);
  assert.equal(result.output, "hello-tool-exec");
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

test("tool executor supports http.request", async () => {
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
  await listen(server);

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
