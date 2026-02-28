#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { resolve } from "node:path";

const DEFAULT_GATEWAY = "http://127.0.0.1:8787";
const DEFAULT_SCOPE = "user";
const BUNDLE_FIXTURE_PATH = new URL("../fixtures/skills/openfoal-ppt-v1/bundle.json", import.meta.url);

main().catch((error) => {
  console.error(`[ppt-e2e] FAIL: ${toErrorMessage(error)}`);
  process.exit(1);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const gateway = new URL(options.gateway);
  if (gateway.protocol !== "http:") {
    throw new Error(`仅支持 http 网关地址，收到: ${options.gateway}`);
  }

  const runId = `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
  const connectionId = `ppt_e2e_${runId}`;
  const outputRelative = options.out ?? `./.openfoal/output/ppt-e2e-${options.mode}.pptx`;
  const outputAbsolute = resolve(process.cwd(), outputRelative);
  const metaAbsolute = `${outputAbsolute}.meta.json`;

  prepareOutput(outputAbsolute, metaAbsolute);

  const scopeParams = buildScopeParams(options);
  const connectParams = options.authToken ? { auth: { token: options.authToken } } : {};

  console.log(`[ppt-e2e] gateway=${options.gateway}`);
  console.log(`[ppt-e2e] mode=${options.mode}`);
  console.log(`[ppt-e2e] output=${outputRelative}`);

  await rpcExpectOk({ gateway, connectionId }, "r_connect", "connect", connectParams);

  const modelMeta = await rpcExpectOk(
    { gateway, connectionId },
    "r_model_meta",
    "secrets.getModelKeyMeta",
    {
      ...scopeParams
    }
  );
  const modelItems = asArray(modelMeta.response.payload?.items);
  const chosenModel = chooseModel(modelItems, {
    provider: options.provider,
    modelId: options.modelId
  });
  if (!chosenModel) {
    throw new Error(
      "未找到可用模型 key。请先配置 secrets.upsertModelKey，或通过 --provider/--model 指定已配置模型。"
    );
  }
  console.log(`[ppt-e2e] model=${chosenModel.provider}${chosenModel.modelId ? `/${chosenModel.modelId}` : ""}`);

  const bundle = loadBundleFixture();
  bundle.bundleId = `bundle_openfoal_ppt_v1_${runId}`;
  bundle.name = `openfoal-ppt-v1-bundle-${runId}`;

  const imported = await rpcExpectOk(
    { gateway, connectionId },
    "r_bundle_import",
    "skills.bundle.import",
    {
      idempotencyKey: `idem_ppt_bundle_import_${runId}`,
      bundle,
      ...scopeParams
    }
  );
  console.log(`[ppt-e2e] imported=${String(imported.response.payload?.importedCount ?? 0)}`);

  if (options.assertBundleOnly) {
    await assertBundleOnlyPolicy({ gateway, connectionId, runId, scopeParams });
  }

  const installed = await rpcExpectOk(
    { gateway, connectionId },
    "r_skill_install",
    "skills.install",
    {
      idempotencyKey: `idem_ppt_skill_install_${runId}`,
      scope: options.scope,
      skillId: "openfoal-ppt-v1",
      ...scopeParams
    }
  );
  const invocation = asString(installed.response.payload?.item?.invocation) ?? "";
  if (invocation !== "/skill:openfoal-ppt-v1") {
    throw new Error(`安装后 invocation 异常: ${invocation || "<empty>"}`);
  }

  const installedList = await rpcExpectOk(
    { gateway, connectionId },
    "r_skill_list",
    "skills.installed.list",
    {
      scope: options.scope,
      ...scopeParams
    }
  );
  const hasInstalled = asArray(installedList.response.payload?.items).some(
    (item) => asString(item.skillId) === "openfoal-ppt-v1"
  );
  if (!hasInstalled) {
    throw new Error("skills.installed.list 未返回 openfoal-ppt-v1");
  }

  const args = {
    title: options.title,
    slides: options.slides,
    lang: options.lang,
    out: outputRelative,
    ...(options.theme ? { theme: options.theme } : {})
  };

  const run = await rpcExpectOk(
    { gateway, connectionId, timeoutMs: options.runTimeoutMs },
    "r_skill_run",
    "agent.run",
    {
      idempotencyKey: `idem_ppt_skill_run_${runId}`,
      sessionId: `s_ppt_skill_${runId}`,
      input: `/skill:openfoal-ppt-v1 ${JSON.stringify(args)}`,
      runtimeMode: "local",
      llm: {
        provider: chosenModel.provider,
        ...(chosenModel.modelId ? { modelId: chosenModel.modelId } : {}),
        ...(chosenModel.baseUrl ? { baseUrl: chosenModel.baseUrl } : {})
      },
      ...scopeParams
    }
  );

  validateRunEvents(run.events);
  validateArtifacts({
    outputAbsolute,
    outputRelative,
    metaAbsolute,
    expected: args
  });

  console.log("[ppt-e2e] PASS: pptx + meta validated");
}

function prepareOutput(outputAbsolute, metaAbsolute) {
  rmSync(outputAbsolute, { force: true });
  rmSync(metaAbsolute, { force: true });
}

function loadBundleFixture() {
  if (!existsSync(BUNDLE_FIXTURE_PATH)) {
    throw new Error(`缺少 bundle fixture: ${BUNDLE_FIXTURE_PATH.pathname}`);
  }
  const raw = JSON.parse(readFileSync(BUNDLE_FIXTURE_PATH, "utf8"));
  return structuredClone(raw);
}

async function assertBundleOnlyPolicy(input) {
  const refresh = await rpc(
    { gateway: input.gateway, connectionId: input.connectionId },
    "r_bundle_only_refresh",
    "skills.catalog.refresh",
    {
      idempotencyKey: `idem_bundle_only_refresh_${input.runId}`,
      scope: "user",
      ...input.scopeParams
    }
  );
  if (refresh.response.ok || refresh.response.error?.code !== "POLICY_DENIED") {
    throw new Error("assertBundleOnly 失败：skills.catalog.refresh 未被 POLICY_DENIED 阻断");
  }

  const probeBundle = {
    bundleId: `bundle_probe_online_${input.runId}`,
    name: `bundle-probe-online-${input.runId}`,
    items: [
      {
        skillId: `probe.online.${input.runId}`,
        sourceType: "online",
        tags: ["probe"],
        artifactVersion: "v1",
        entrySkillPath: "SKILL.md",
        files: [
          {
            path: "SKILL.md",
            content: "# probe online\n"
          }
        ]
      }
    ]
  };

  const imported = await rpc(
    { gateway: input.gateway, connectionId: input.connectionId },
    "r_bundle_only_probe_import",
    "skills.bundle.import",
    {
      idempotencyKey: `idem_bundle_only_probe_import_${input.runId}`,
      bundle: probeBundle,
      ...input.scopeParams
    }
  );
  if (!imported.response.ok) {
    throw new Error(`assertBundleOnly 失败：probe bundle 导入失败 (${imported.response.error?.code ?? "unknown"})`);
  }

  const installed = await rpc(
    { gateway: input.gateway, connectionId: input.connectionId },
    "r_bundle_only_probe_install",
    "skills.install",
    {
      idempotencyKey: `idem_bundle_only_probe_install_${input.runId}`,
      scope: "user",
      skillId: `probe.online.${input.runId}`,
      ...input.scopeParams
    }
  );
  if (installed.response.ok || installed.response.error?.code !== "POLICY_DENIED") {
    throw new Error("assertBundleOnly 失败：online source skill 安装未被 POLICY_DENIED 阻断");
  }

  console.log("[ppt-e2e] bundle_only policy assertion passed");
}

function chooseModel(items, filter) {
  if (!Array.isArray(items) || items.length === 0) {
    return undefined;
  }
  const providerFilter = filter.provider?.trim().toLowerCase();
  const modelFilter = filter.modelId?.trim();

  const normalized = items
    .map((item) => ({
      provider: asString(item.provider),
      modelId: asString(item.modelId),
      baseUrl: asString(item.baseUrl)
    }))
    .filter((item) => Boolean(item.provider));

  if (normalized.length === 0) {
    return undefined;
  }

  if (providerFilter && modelFilter) {
    return normalized.find(
      (item) => item.provider?.toLowerCase() === providerFilter && item.modelId === modelFilter
    );
  }
  if (providerFilter) {
    return normalized.find((item) => item.provider?.toLowerCase() === providerFilter);
  }
  return normalized[0];
}

function validateRunEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("agent.run 未返回事件");
  }
  const failed = events.find((event) => event?.event === "agent.failed");
  if (failed) {
    throw new Error(`agent.failed: ${asString(failed.payload?.code) ?? "UNKNOWN"} ${asString(failed.payload?.message) ?? ""}`);
  }
  const completed = events.find((event) => event?.event === "agent.completed");
  if (!completed) {
    throw new Error("agent.run 未返回 agent.completed");
  }
  const toolCalls = events.filter((event) => event?.event === "agent.tool_call");
  if (toolCalls.length === 0) {
    throw new Error("agent.run 未观测到 tool_call，skill 可能未执行生成链路");
  }
}

function validateArtifacts(input) {
  if (!existsSync(input.outputAbsolute)) {
    throw new Error(`未找到输出文件: ${input.outputAbsolute}（要求网关与脚本共享同一文件系统）`);
  }
  const stat = statSync(input.outputAbsolute);
  if (stat.size <= 0) {
    throw new Error(`输出文件大小异常: ${input.outputAbsolute}`);
  }

  const pptBuffer = readFileSync(input.outputAbsolute);
  if (pptBuffer.length < 4 || pptBuffer[0] !== 0x50 || pptBuffer[1] !== 0x4b) {
    throw new Error(`输出文件不是 zip/pptx: ${input.outputAbsolute}`);
  }

  const entries = listZipEntriesFromCentralDirectory(pptBuffer);
  if (!entries.includes("[Content_Types].xml")) {
    throw new Error("pptx 缺少 [Content_Types].xml");
  }
  if (!entries.some((entry) => /^ppt\/slides\/slide\d+\.xml$/u.test(entry))) {
    throw new Error("pptx 缺少 slide xml");
  }

  if (!existsSync(input.metaAbsolute)) {
    throw new Error(`缺少元数据文件: ${input.metaAbsolute}`);
  }
  const meta = JSON.parse(readFileSync(input.metaAbsolute, "utf8"));
  if (meta.skillId !== "openfoal-ppt-v1") {
    throw new Error(`meta.skillId 异常: ${String(meta.skillId)}`);
  }
  if (meta.engine !== "pptxgenjs") {
    throw new Error(`meta.engine 异常: ${String(meta.engine)}`);
  }
  if (meta.slideCount !== input.expected.slides) {
    throw new Error(`meta.slideCount 异常: expect=${String(input.expected.slides)} actual=${String(meta.slideCount)}`);
  }
  if (meta.title !== input.expected.title) {
    throw new Error(`meta.title 异常: expect=${input.expected.title} actual=${String(meta.title)}`);
  }
  if (meta.outputPath !== input.outputRelative) {
    throw new Error(`meta.outputPath 异常: expect=${input.outputRelative} actual=${String(meta.outputPath)}`);
  }
  if (!isIsoDate(meta.generatedAt)) {
    throw new Error(`meta.generatedAt 非 ISO 时间: ${String(meta.generatedAt)}`);
  }

  const checksum = sha256(pptBuffer);
  if (asString(meta.checksum) !== checksum) {
    throw new Error(`meta.checksum 校验失败: expect=${checksum} actual=${String(meta.checksum)}`);
  }

  console.log(`[ppt-e2e] slides=${String(meta.slideCount)} checksum=${checksum.slice(0, 12)}...`);
}

function listZipEntriesFromCentralDirectory(buffer) {
  const eocdOffset = findEocdOffset(buffer);
  if (eocdOffset < 0) {
    throw new Error("zip 结构错误：缺少 EOCD");
  }
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  const names = [];
  let offset = centralDirOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (offset + 46 > buffer.length) {
      throw new Error("zip 结构错误：central directory 越界");
    }
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x02014b50) {
      throw new Error(`zip 结构错误：central directory header 签名无效 at ${String(offset)}`);
    }
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);

    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > buffer.length) {
      throw new Error("zip 结构错误：文件名越界");
    }
    names.push(buffer.subarray(nameStart, nameEnd).toString("utf8"));

    offset = nameEnd + extraLength + commentLength;
  }
  return names;
}

function findEocdOffset(buffer) {
  const min = Math.max(0, buffer.length - 65_557);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      return i;
    }
  }
  return -1;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function buildScopeParams(options) {
  const out = {};
  if (options.tenantId) {
    out.tenantId = options.tenantId;
  }
  if (options.workspaceId) {
    out.workspaceId = options.workspaceId;
  }
  if (options.userId) {
    out.userId = options.userId;
  }
  return out;
}

function parseArgs(argv) {
  const options = {
    help: false,
    gateway: DEFAULT_GATEWAY,
    mode: "personal",
    scope: DEFAULT_SCOPE,
    tenantId: undefined,
    workspaceId: undefined,
    userId: undefined,
    provider: undefined,
    modelId: undefined,
    title: "OpenFoal PPT E2E",
    slides: 8,
    lang: "zh-CN",
    theme: undefined,
    out: undefined,
    authToken: process.env.OPENFOAL_AUTH_TOKEN,
    assertBundleOnly: false,
    runTimeoutMs: 300_000
  };

  const readNext = (index, flag) => {
    if (index + 1 >= argv.length) {
      throw new Error(`缺少参数值: ${flag}`);
    }
    return argv[index + 1];
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--gateway":
        options.gateway = readNext(i, arg);
        i += 1;
        break;
      case "--mode": {
        const value = readNext(i, arg);
        if (value !== "personal" && value !== "enterprise") {
          throw new Error(`--mode 仅支持 personal|enterprise，收到: ${value}`);
        }
        options.mode = value;
        i += 1;
        break;
      }
      case "--scope": {
        const value = readNext(i, arg);
        if (value !== "user" && value !== "workspace" && value !== "tenant") {
          throw new Error(`--scope 仅支持 user|workspace|tenant，收到: ${value}`);
        }
        options.scope = value;
        i += 1;
        break;
      }
      case "--tenant":
        options.tenantId = readNext(i, arg);
        i += 1;
        break;
      case "--workspace":
        options.workspaceId = readNext(i, arg);
        i += 1;
        break;
      case "--user":
        options.userId = readNext(i, arg);
        i += 1;
        break;
      case "--provider":
        options.provider = readNext(i, arg);
        i += 1;
        break;
      case "--model":
        options.modelId = readNext(i, arg);
        i += 1;
        break;
      case "--title":
        options.title = readNext(i, arg);
        i += 1;
        break;
      case "--slides": {
        const value = Number(readNext(i, arg));
        if (!Number.isFinite(value)) {
          throw new Error(`--slides 不是数字: ${argv[i + 1] ?? ""}`);
        }
        options.slides = Math.trunc(value);
        i += 1;
        break;
      }
      case "--lang": {
        const value = readNext(i, arg);
        if (value !== "zh-CN" && value !== "en-US") {
          throw new Error(`--lang 仅支持 zh-CN|en-US，收到: ${value}`);
        }
        options.lang = value;
        i += 1;
        break;
      }
      case "--theme":
        options.theme = readNext(i, arg);
        i += 1;
        break;
      case "--out":
        options.out = readNext(i, arg);
        i += 1;
        break;
      case "--auth-token":
        options.authToken = readNext(i, arg);
        i += 1;
        break;
      case "--assert-bundle-only":
        options.assertBundleOnly = true;
        break;
      case "--timeout-ms": {
        const value = Number(readNext(i, arg));
        if (!Number.isFinite(value) || value < 30_000) {
          throw new Error(`--timeout-ms 必须 >= 30000，收到: ${argv[i + 1] ?? ""}`);
        }
        options.runTimeoutMs = Math.trunc(value);
        i += 1;
        break;
      }
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }

  if (options.mode === "enterprise") {
    options.tenantId = options.tenantId ?? "t_default";
    options.workspaceId = options.workspaceId ?? "w_default";
  }

  if (options.slides < 3 || options.slides > 30) {
    throw new Error(`slides 超出范围（3-30）：${String(options.slides)}`);
  }

  return options;
}

function printHelp() {
  console.log(`OpenFoal PPT skill E2E

Usage:
  node scripts/skill-ppt-e2e.mjs [options]

Options:
  --gateway <url>           Gateway URL (default: http://127.0.0.1:8787)
  --mode <personal|enterprise>
  --scope <user|workspace|tenant>
  --tenant <id>
  --workspace <id>
  --user <id>
  --provider <provider>
  --model <modelId>
  --title <text>
  --slides <3-30>
  --lang <zh-CN|en-US>
  --theme <name>
  --out <relative-path>
  --auth-token <token>
  --assert-bundle-only      Assert POLICY_DENIED for online refresh/install
  --timeout-ms <ms>         agent.run timeout (default: 300000)
  --help
`);
}

async function rpc(ctx, id, method, params) {
  const payload = {
    type: "req",
    id,
    method,
    params
  };
  const endpoint = buildRpcEndpoint(ctx.gateway, ctx.connectionId);
  const result = await httpJson({
    method: "POST",
    host: endpoint.host,
    port: endpoint.port,
    path: endpoint.path,
    body: payload,
    timeoutMs: ctx.timeoutMs ?? 60_000
  });
  if (result.statusCode !== 200) {
    throw new Error(`RPC HTTP ${result.statusCode}: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function rpcExpectOk(ctx, id, method, params) {
  const frame = await rpc(ctx, id, method, params);
  if (!frame?.response?.ok) {
    const code = asString(frame?.response?.error?.code) ?? "UNKNOWN";
    const message = asString(frame?.response?.error?.message) ?? "";
    throw new Error(`${method} failed: [${code}] ${message}`);
  }
  return frame;
}

function buildRpcEndpoint(gateway, connectionId) {
  const basePath = gateway.pathname.endsWith("/") ? gateway.pathname.slice(0, -1) : gateway.pathname;
  const path = `${basePath}/rpc?connectionId=${encodeURIComponent(connectionId)}`;
  return {
    host: gateway.hostname,
    port: Number(gateway.port || "80"),
    path
  };
}

function httpJson({ method, host, port, path, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
    const req = httpRequest(
      {
        method,
        host,
        port,
        path,
        timeout: timeoutMs,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": String(payload.length)
            }
          : undefined
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed;
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch {
            parsed = { raw: text };
          }
          resolve({
            statusCode: res.statusCode ?? 0,
            body: parsed
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`HTTP timeout after ${String(timeoutMs)}ms`));
    });
    req.on("error", reject);

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isIsoDate(value) {
  const text = asString(value);
  if (!text) {
    return false;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed);
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
