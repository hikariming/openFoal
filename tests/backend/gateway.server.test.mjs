import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createConnection } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { startGatewayServer } from "../../apps/gateway/dist/index.js";

function req(id, method, params = {}) {
  return {
    type: "req",
    id,
    method,
    params
  };
}

test("gateway HTTP exposes health and rpc", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openfoal-gateway-server-http-"));
  const dbPath = join(dir, "gateway.sqlite");
  const server = await startGatewayServer({
    host: "127.0.0.1",
    port: 0,
    sqlitePath: dbPath
  });
  try {
    const health = await httpJson({
      method: "GET",
      port: server.port,
      path: "/health"
    });
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.ok, true);

    const connected = await httpJson({
      method: "POST",
      port: server.port,
      path: "/rpc?connectionId=http_case_1",
      body: req("r_connect", "connect", {})
    });
    assert.equal(connected.statusCode, 200);
    assert.equal(connected.body.response.ok, true);

    const listed = await httpJson({
      method: "POST",
      port: server.port,
      path: "/rpc?connectionId=http_case_1",
      body: req("r_list", "sessions.list", {})
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.body.response.ok, true);
    assert.equal(Array.isArray(listed.body.response.payload.sessions), true);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gateway WS handles connect and agent.run stream", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openfoal-gateway-server-ws-"));
  const dbPath = join(dir, "gateway.sqlite");
  const server = await startGatewayServer({
    host: "127.0.0.1",
    port: 0,
    sqlitePath: dbPath
  });
  const ws = await openWs(server.port);
  try {
    ws.sendJson(req("r_connect", "connect", {}));
    const connectRes = await ws.readJson();
    assert.equal(connectRes.type, "res");
    assert.equal(connectRes.id, "r_connect");
    assert.equal(connectRes.ok, true);

    ws.sendJson(
      req("r_run", "agent.run", {
        idempotencyKey: "idem_ws_run_1",
        sessionId: "s_default",
        input: "run [[tool:text.upper {\"text\": \"hello\"}]]",
        runtimeMode: "local"
      })
    );

    const messages = [];
    while (messages.length < 10) {
      const frame = await ws.readJson();
      messages.push(frame);
      if (frame.type === "event" && frame.event === "agent.completed") {
        break;
      }
    }

    const runRes = messages.find((frame) => frame.type === "res" && frame.id === "r_run");
    assert.equal(runRes?.ok, true);

    const eventNames = messages.filter((frame) => frame.type === "event").map((frame) => frame.event);
    assert.equal(eventNames.includes("agent.accepted"), true);
    assert.equal(eventNames.includes("agent.tool_call"), true);
    assert.equal(eventNames.includes("agent.tool_result"), true);
    assert.equal(eventNames.includes("agent.completed"), true);
  } finally {
    ws.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function httpJson({ method, port, path, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": String(payload.length)
            }
          : undefined
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            statusCode: res.statusCode ?? 0,
            body: text.length > 0 ? JSON.parse(text) : null
          });
        });
      }
    );

    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function openWs(port) {
  const socket = createConnection({ host: "127.0.0.1", port });
  const state = {
    handshakeDone: false,
    raw: Buffer.alloc(0),
    queue: [],
    waiters: []
  };

  socket.on("data", (chunk) => {
    state.raw = Buffer.concat([state.raw, chunk]);
    if (!state.handshakeDone) {
      const delimiter = state.raw.indexOf("\r\n\r\n");
      if (delimiter === -1) {
        return;
      }
      const head = state.raw.slice(0, delimiter).toString("utf8");
      if (!head.startsWith("HTTP/1.1 101")) {
        throw new Error(`ws handshake failed: ${head}`);
      }
      state.handshakeDone = true;
      state.raw = state.raw.slice(delimiter + 4);
    }

    while (true) {
      const parsed = tryParseFrame(state.raw);
      if (!parsed) {
        break;
      }
      state.raw = parsed.rest;
      if (parsed.opcode === 0x1) {
        const value = JSON.parse(parsed.payload.toString("utf8"));
        const waiter = state.waiters.shift();
        if (waiter) {
          waiter.resolve(value);
        } else {
          state.queue.push(value);
        }
      }
    }
  });

  await once(socket, "connect");

  const wsKey = randomBytes(16).toString("base64");
  socket.write(
    [
      "GET /ws HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${wsKey}`,
      "Sec-WebSocket-Version: 13",
      "",
      ""
    ].join("\r\n")
  );

  const start = Date.now();
  while (!state.handshakeDone) {
    if (Date.now() - start > 2000) {
      throw new Error("ws handshake timeout");
    }
    await sleep(5);
  }

  return {
    sendJson(value) {
      socket.write(encodeClientFrame(JSON.stringify(value)));
    },
    async readJson(timeoutMs = 2000) {
      if (state.queue.length > 0) {
        return state.queue.shift();
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("timeout waiting ws frame"));
        }, timeoutMs);
        state.waiters.push({
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          }
        });
      });
    },
    close() {
      if (!socket.destroyed) {
        socket.end();
        socket.destroy();
      }
    }
  };
}

function encodeClientFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const mask = randomBytes(4);
  const header = [];

  header.push(0x81);
  if (payload.length < 126) {
    header.push(0x80 | payload.length);
  } else if (payload.length <= 0xffff) {
    header.push(0x80 | 126, (payload.length >>> 8) & 0xff, payload.length & 0xff);
  } else {
    throw new Error("payload too large for test client");
  }

  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    masked[i] = payload[i] ^ mask[i % 4];
  }

  return Buffer.concat([Buffer.from(header), mask, masked]);
}

function tryParseFrame(raw) {
  if (raw.length < 2) {
    return null;
  }

  const first = raw[0];
  const second = raw[1];
  const opcode = first & 0x0f;
  let offset = 2;
  let payloadLength = second & 0x7f;
  const masked = (second & 0x80) !== 0;

  if (payloadLength === 126) {
    if (raw.length < offset + 2) {
      return null;
    }
    payloadLength = raw.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (raw.length < offset + 8) {
      return null;
    }
    const high = raw.readUInt32BE(offset);
    const low = raw.readUInt32BE(offset + 4);
    payloadLength = high * 2 ** 32 + low;
    offset += 8;
  }

  let mask = null;
  if (masked) {
    if (raw.length < offset + 4) {
      return null;
    }
    mask = raw.subarray(offset, offset + 4);
    offset += 4;
  }

  if (raw.length < offset + payloadLength) {
    return null;
  }

  const payload = Buffer.from(raw.subarray(offset, offset + payloadLength));
  if (mask) {
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] = payload[i] ^ mask[i % 4];
    }
  }

  return {
    opcode,
    payload,
    rest: raw.subarray(offset + payloadLength)
  };
}

function once(target, eventName) {
  return new Promise((resolve, reject) => {
    const onEvent = (...args) => {
      cleanup();
      resolve(args);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      target.off(eventName, onEvent);
      target.off("error", onError);
    };
    target.on(eventName, onEvent);
    target.on("error", onError);
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
