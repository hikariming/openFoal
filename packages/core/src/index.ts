import {
  createLocalToolExecutor,
  type ToolExecutor,
  type ToolResult
} from "../../../packages/tool-executor/dist/index.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Agent, type AgentEvent, type AgentTool, type StreamFn } from "@mariozechner/pi-agent-core";
import {
  Type,
  getEnvApiKey,
  getModel,
  registerBuiltInApiProviders,
  type Message,
  type Model
} from "@mariozechner/pi-ai";
import {
  loadOpenFoalCoreConfig,
  type EnvMap,
  type OpenFoalCoreConfig,
  type OpenFoalLlmModelConfig,
  type OpenFoalLlmProviderConfig
} from "./config.js";
import { join, resolve } from "node:path";

declare const process: any;

export type RuntimeMode = "local" | "cloud";

export interface CoreRunInput {
  sessionId: string;
  input: string;
  runtimeMode: RuntimeMode;
  llm?: {
    modelRef?: string;
    provider?: string;
    modelId?: string;
    apiKey?: string;
    baseUrl?: string;
  };
}

export interface CoreContinueInput {
  runId: string;
  input: string;
}

export type CoreEvent =
  | {
      type: "accepted";
      runId: string;
      sessionId: string;
      runtimeMode: RuntimeMode;
    }
  | {
      type: "delta";
      runId: string;
      text: string;
    }
  | {
      type: "tool_call_start";
      runId: string;
      toolCallId: string;
      toolName: string;
    }
  | {
      type: "tool_call_delta";
      runId: string;
      toolCallId: string;
      toolName: string;
      delta: string;
    }
  | {
      type: "tool_call";
      runId: string;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_result_start";
      runId: string;
      toolCallId: string;
      toolName: string;
    }
  | {
      type: "tool_result_delta";
      runId: string;
      toolCallId: string;
      toolName: string;
      delta: string;
    }
  | {
      type: "tool_result";
      runId: string;
      toolCallId: string;
      toolName: string;
      output: string;
    }
  | {
      type: "completed";
      runId: string;
      output: string;
    }
  | {
      type: "failed";
      runId: string;
      code: string;
      message: string;
    };

export interface CoreService {
  run(input: CoreRunInput): AsyncIterable<CoreEvent>;
  continue(input: CoreContinueInput): AsyncIterable<CoreEvent>;
  abort(runId: string): Promise<void>;
}

export type { ToolCall, ToolContext, ToolExecutor, ToolResult } from "../../../packages/tool-executor/dist/index.js";

export interface PiCoreOptions {
  modelRef?: string;
  provider?: string;
  modelId?: string;
  apiKey?: string;
  baseUrl?: string;
  systemPrompt?: string;
  workspaceRoot?: string;
  ensureBootstrapFiles?: boolean;
  bootstrapMaxChars?: number;
  streamFn?: StreamFn;
  configPath?: string;
  policyPath?: string;
}

export interface PiRuntimeSettingsOptions extends PiCoreOptions {
  env?: EnvMap;
}

export interface PiRuntimeSettings {
  config: OpenFoalCoreConfig;
  modelRef?: string;
  provider?: string;
  modelId?: string;
  model?: Model<any>;
  apiKeys: Record<string, string>;
}

export interface RuntimeCoreOptions {
  toolExecutor?: ToolExecutor;
  engine?: "pi" | "legacy" | "auto";
  pi?: PiCoreOptions;
}

interface RunState {
  aborted: boolean;
}

interface ActiveRun {
  aborted: boolean;
  agent?: Agent;
}

interface ParsedDirective {
  name: string;
  args: Record<string, unknown>;
}

interface ParsedInput {
  text: string;
  directives: ParsedDirective[];
}

const TOOL_DIRECTIVE_PATTERN = /\[\[tool:([a-zA-Z0-9._-]+)(?:\s+([\s\S]*?))?\]\]/g;
const DEFAULT_SYSTEM_PROMPT = "You are OpenFoal assistant.";
const DEFAULT_BOOTSTRAP_MAX_CHARS = 8_000;
const DEFAULT_BOOTSTRAP_FILES = ["AGENTS.md", "SOUL.md", "TOOLS.md", "USER.md"] as const;
const PUBLIC_TOOL_NAMES = [
  "bash.exec",
  "file.read",
  "file.write",
  "file.list",
  "http.request",
  "memory.get",
  "memory.search",
  "memory.appendDaily",
  "math.add",
  "text.upper",
  "echo"
] as const;

let piProvidersRegistered = false;

export function createRuntimeCoreService(options: RuntimeCoreOptions = {}): CoreService {
  const engine = resolveEngine(options.engine);
  if (engine === "legacy") {
    return createLegacyRuntimeCoreService(options);
  }
  if (engine === "pi") {
    return createPiCoreService(options);
  }
  try {
    return createPiCoreService(options);
  } catch {
    return createLegacyRuntimeCoreService(options);
  }
}

export function createPiCoreService(options: RuntimeCoreOptions = {}): CoreService {
  const toolExecutor = options.toolExecutor ?? createBuiltinToolExecutor();
  const piOptions = options.pi ?? {};
  const running = new Map<string, ActiveRun>();
  let runCounter = 0;

  ensurePiProviders();

  return {
    async *run(input: CoreRunInput): AsyncIterable<CoreEvent> {
      const runId = `run_${++runCounter}`;
      const activeRun: ActiveRun = { aborted: false };
      running.set(runId, activeRun);

      yield {
        type: "accepted",
        runId,
        sessionId: input.sessionId,
        runtimeMode: input.runtimeMode
      };

      if (activeRun.aborted) {
        yield {
          type: "failed",
          runId,
          code: "ABORTED",
          message: "Run aborted"
        };
        running.delete(runId);
        return;
      }

      const queue = new AsyncQueue<CoreEvent>();
      let failed = false;
      let completed = false;
      let outputText = "";

      try {
        const runtimeSettings = resolvePiRuntimeSettings({
          ...piOptions,
          ...(input.llm ?? {})
        });
        if (!runtimeSettings.model && (!runtimeSettings.provider || !runtimeSettings.modelId)) {
          yield {
            type: "failed",
            runId,
            code: "MODEL_UNAVAILABLE",
            message: "No model configured. Set provider/modelId and API key."
          };
          return;
        }
        if (runtimeSettings.provider) {
          const providerApiKey = resolveApiKey(runtimeSettings.provider, runtimeSettings, piOptions);
          if (!providerApiKey) {
            yield {
              type: "failed",
              runId,
              code: "MODEL_UNAVAILABLE",
              message: `No API key for provider: ${runtimeSettings.provider}`
            };
            return;
          }
        }
        const systemPrompt = buildSystemPromptWithWorkspace(piOptions);
        const streamFn = resolvePiStreamFn(piOptions);
        const tools = createPiTools(toolExecutor, {
          runId,
          sessionId: input.sessionId,
          runtimeMode: input.runtimeMode
        });

        const agent = new Agent({
          initialState: {
            ...(runtimeSettings.model ? { model: runtimeSettings.model as Model<any> } : {}),
            systemPrompt,
            tools
          },
          streamFn,
          getApiKey: (provider) => resolveApiKey(provider, runtimeSettings, piOptions),
          sessionId: input.sessionId
        });
        activeRun.agent = agent;

        const unsubscribe = agent.subscribe((event: AgentEvent) => {
          if (completed) {
            return;
          }
          const mapped = mapPiEvent(event, runId);
          for (const coreEvent of mapped) {
            queue.push(coreEvent);
            if (coreEvent.type === "failed") {
              failed = true;
            }
          }
        });

        const promptTask = (async () => {
          try {
            await agent.prompt(input.input);
            outputText = extractLatestAssistantText(agent.state.messages);
            if (!failed) {
              queue.push({
                type: "completed",
                runId,
                output: outputText.length > 0 ? outputText : "(empty output)"
              });
            }
          } catch (error) {
            if (!failed) {
              queue.push({
                type: "failed",
                runId,
                code: activeRun.aborted ? "ABORTED" : "INTERNAL_ERROR",
                message: toErrorMessage(error)
              });
            }
          } finally {
            completed = true;
            unsubscribe();
            running.delete(runId);
            queue.close();
          }
        })();

        while (true) {
          const event = await queue.next();
          if (!event) {
            break;
          }
          yield event;
        }

        await promptTask;
      } finally {
        running.delete(runId);
      }
    },

    async *continue(input: CoreContinueInput): AsyncIterable<CoreEvent> {
      const run = running.get(input.runId);
      if (!run?.agent) {
        yield {
          type: "failed",
          runId: input.runId,
          code: "INVALID_REQUEST",
          message: "run 不存在或不可继续"
        };
        return;
      }

      try {
        await run.agent.continue();
        const output = extractLatestAssistantText(run.agent.state.messages);
        yield {
          type: "delta",
          runId: input.runId,
          text: output
        };
        yield {
          type: "completed",
          runId: input.runId,
          output
        };
      } catch (error) {
        yield {
          type: "failed",
          runId: input.runId,
          code: "INTERNAL_ERROR",
          message: toErrorMessage(error)
        };
      }
    },

    async abort(runId: string): Promise<void> {
      const run = running.get(runId);
      if (run) {
        run.aborted = true;
        run.agent?.abort();
      }
    }
  };
}

export function createLegacyRuntimeCoreService(options: RuntimeCoreOptions = {}): CoreService {
  const toolExecutor = options.toolExecutor ?? createBuiltinToolExecutor();
  const runStates = new Map<string, RunState>();
  const detachedAborts = new Set<string>();
  let runCounter = 0;

  return {
    async *run(input: CoreRunInput): AsyncIterable<CoreEvent> {
      const runId = `run_${++runCounter}`;
      const state = createRunState(runId, runStates, detachedAborts);

      try {
        yield {
          type: "accepted",
          runId,
          sessionId: input.sessionId,
          runtimeMode: input.runtimeMode
        };

        const parsed = parseInput(input.input);
        if (!parsed.ok) {
          yield {
            type: "failed",
            runId,
            code: "INVALID_REQUEST",
            message: parsed.error
          };
          return;
        }

        const outcome = await executeLegacyToolLoop({
          runId,
          sessionId: input.sessionId,
          runtimeMode: input.runtimeMode,
          parsed: parsed.data,
          state,
          toolExecutor
        });

        for (const event of outcome.events) {
          yield event;
        }
      } finally {
        runStates.delete(runId);
      }
    },

    async *continue(input: CoreContinueInput): AsyncIterable<CoreEvent> {
      const state = createRunState(input.runId, runStates, detachedAborts);
      const parsed = parseInput(input.input);
      if (!parsed.ok) {
        yield {
          type: "failed",
          runId: input.runId,
          code: "INVALID_REQUEST",
          message: parsed.error
        };
        runStates.delete(input.runId);
        return;
      }

      try {
        const outcome = await executeLegacyToolLoop({
          runId: input.runId,
          sessionId: "continue_session",
          runtimeMode: "local",
          parsed: parsed.data,
          state,
          toolExecutor
        });

        for (const event of outcome.events) {
          yield event;
        }
      } finally {
        runStates.delete(input.runId);
      }
    },

    async abort(runId: string): Promise<void> {
      const state = runStates.get(runId);
      if (state) {
        state.aborted = true;
      } else {
        detachedAborts.add(runId);
      }
    }
  };
}

export function createBuiltinToolExecutor(): ToolExecutor {
  return createLocalToolExecutor();
}

function buildSystemPromptWithWorkspace(options: PiCoreOptions): string {
  const basePrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
  const ensureFiles = options.ensureBootstrapFiles !== false;
  const maxChars = Number.isFinite(Number(options.bootstrapMaxChars))
    ? Math.max(500, Math.floor(Number(options.bootstrapMaxChars)))
    : DEFAULT_BOOTSTRAP_MAX_CHARS;

  if (ensureFiles) {
    ensureWorkspaceBootstrapFiles(workspaceRoot);
  }

  const files = loadWorkspaceBootstrapFiles(workspaceRoot, maxChars);
  if (files.length === 0) {
    return basePrompt;
  }

  const lines: string[] = [basePrompt, "", "## Project Context"];
  lines.push(
    "Follow workspace guidance files. Security/policy/system constraints always take precedence over style/persona rules."
  );
  lines.push(
    "Memory recall rule: before answering questions about prior work, decisions, dates, preferences, or todos, run memory.search first, then use memory.get for exact lines."
  );
  lines.push("");
  for (const file of files) {
    lines.push(`### ${file.name}`);
    lines.push(file.content);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function resolveWorkspaceRoot(input: string | undefined): string {
  const explicit = firstNonEmpty(input, process.env.OPENFOAL_WORKSPACE_ROOT);
  if (explicit) {
    return resolve(explicit);
  }
  return resolve(process.cwd());
}

function ensureWorkspaceBootstrapFiles(workspaceRoot: string): void {
  mkdirSync(workspaceRoot, { recursive: true });
  for (const fileName of DEFAULT_BOOTSTRAP_FILES) {
    const filePath = join(workspaceRoot, fileName);
    if (existsSync(filePath)) {
      continue;
    }
    writeFileSync(filePath, defaultBootstrapContent(fileName), {
      encoding: "utf8",
      flag: "wx"
    });
  }
}

function loadWorkspaceBootstrapFiles(
  workspaceRoot: string,
  maxChars: number
): Array<{ name: string; content: string }> {
  const items: Array<{ name: string; content: string }> = [];
  for (const fileName of DEFAULT_BOOTSTRAP_FILES) {
    const filePath = join(workspaceRoot, fileName);
    if (!existsSync(filePath)) {
      continue;
    }
    try {
      const raw = readFileSync(filePath, "utf8");
      items.push({
        name: fileName,
        content: truncateBootstrapContent(raw, maxChars, fileName)
      });
    } catch {
      // ignore unreadable context file
    }
  }
  return items;
}

function truncateBootstrapContent(content: string, maxChars: number, fileName: string): string {
  if (content.length <= maxChars) {
    return content;
  }
  const head = content.slice(0, Math.floor(maxChars * 0.75));
  const tail = content.slice(content.length - Math.floor(maxChars * 0.2));
  return `${head}\n\n[...truncated, read ${fileName} for full content...]\n\n${tail}`;
}

function defaultBootstrapContent(fileName: (typeof DEFAULT_BOOTSTRAP_FILES)[number]): string {
  switch (fileName) {
    case "AGENTS.md":
      return "# AGENTS.md\n\n- Follow project coding and safety policies.\n- Keep responses concise and executable.\n";
    case "SOUL.md":
      return "# SOUL.md\n\nPragmatic, direct engineering assistant persona.\n";
    case "TOOLS.md":
      return "# TOOLS.md\n\n- Prefer workspace-safe tools.\n- Explain side effects before destructive actions.\n";
    case "USER.md":
      return "# USER.md\n\n- Preferred language: zh-CN\n- Style: concise and practical\n";
    default:
      return "";
  }
}

function resolveEngine(engine: RuntimeCoreOptions["engine"]): "pi" | "legacy" | "auto" {
  if (engine) {
    return engine;
  }

  const fromEnv = process.env.OPENFOAL_CORE_ENGINE;
  if (fromEnv === "legacy" || fromEnv === "pi" || fromEnv === "auto") {
    return fromEnv;
  }

  const nodeMajor = Number(String(process.versions?.node ?? "0").split(".")[0] ?? "0");
  if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
    return "legacy";
  }
  // Keep local/personal default behavior stable when no explicit engine is configured.
  return "legacy";
}

function ensurePiProviders(): void {
  if (piProvidersRegistered) {
    return;
  }
  registerBuiltInApiProviders();
  piProvidersRegistered = true;
}

export { MissingConfigEnvVarError, loadOpenFoalCoreConfig } from "./config.js";
export type {
  EnvMap,
  OpenFoalCoreConfig,
  OpenFoalLlmModelConfig,
  OpenFoalLlmProviderConfig,
  OpenFoalModelApi
} from "./config.js";

export function resolvePiRuntimeSettings(options: PiRuntimeSettingsOptions = {}): PiRuntimeSettings {
  const env = options.env ?? (process.env as EnvMap);
  const config = loadOpenFoalCoreConfig({
    configPath: options.configPath,
    policyPath: options.policyPath,
    env
  });
  const modelRef = firstNonEmpty(options.modelRef, config.llm?.defaultModelRef, env.OPENFOAL_PI_MODEL_REF);
  const modelConfig = modelRef ? config.llm?.models?.[modelRef] : undefined;
  const provider = firstNonEmpty(modelConfig?.provider, options.provider, config.llm?.defaultProvider, env.OPENFOAL_PI_PROVIDER);
  const modelId = firstNonEmpty(modelConfig?.modelId, options.modelId, config.llm?.defaultModel, env.OPENFOAL_PI_MODEL);
  const providerConfig = mergeProviderConfig(
    provider ? config.llm?.providers?.[provider] : undefined,
    modelConfig,
    firstNonEmpty(options.baseUrl, env.OPENFOAL_PI_BASE_URL)
  );

  return {
    config,
    modelRef,
    provider,
    modelId,
    model: resolvePiModel(provider, modelId, providerConfig),
    apiKeys: collectApiKeys(config, env, options.apiKey, provider, firstNonEmpty(modelConfig?.apiKey))
  };
}

function mergeProviderConfig(
  providerConfig: OpenFoalLlmProviderConfig | undefined,
  modelConfig: OpenFoalLlmModelConfig | undefined,
  baseUrl: string | undefined
): OpenFoalLlmProviderConfig | undefined {
  const modelOverride = toProviderConfig(modelConfig);
  if (!providerConfig && !modelOverride && !baseUrl) {
    return undefined;
  }
  const merged: OpenFoalLlmProviderConfig = {
    ...(providerConfig ?? {}),
    ...(modelOverride ?? {})
  };
  if (baseUrl) {
    merged.baseUrl = baseUrl;
  }
  return merged;
}

function toProviderConfig(modelConfig: OpenFoalLlmModelConfig | undefined): OpenFoalLlmProviderConfig | undefined {
  if (!modelConfig) {
    return undefined;
  }
  const out: OpenFoalLlmProviderConfig = {};
  if (modelConfig.api) {
    out.api = modelConfig.api;
  }
  if (modelConfig.baseUrl) {
    out.baseUrl = modelConfig.baseUrl;
  }
  if (modelConfig.apiKey) {
    out.apiKey = modelConfig.apiKey;
  }
  if (modelConfig.headers) {
    out.headers = modelConfig.headers;
  }
  if (modelConfig.reasoning !== undefined) {
    out.reasoning = modelConfig.reasoning;
  }
  if (modelConfig.input) {
    out.input = modelConfig.input;
  }
  if (modelConfig.contextWindow !== undefined) {
    out.contextWindow = modelConfig.contextWindow;
  }
  if (modelConfig.maxTokens !== undefined) {
    out.maxTokens = modelConfig.maxTokens;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function resolvePiModel(
  provider: string | undefined,
  modelId: string | undefined,
  providerConfig: OpenFoalLlmProviderConfig | undefined
): Model<any> | undefined {
  if (!provider || !modelId) {
    return undefined;
  }

  ensurePiProviders();
  const needsCustomModel = Boolean(providerConfig?.baseUrl || providerConfig?.api || providerConfig?.headers);
  let builtinModel: Model<any> | undefined;
  try {
    builtinModel = getModel(provider as any, modelId as any);
  } catch {
    builtinModel = undefined;
  }

  if (!needsCustomModel && builtinModel) {
    return builtinModel;
  }
  if (!providerConfig && !builtinModel) {
    return undefined;
  }

  return createConfiguredModel(provider, modelId, providerConfig, builtinModel);
}

function resolvePiStreamFn(options: PiCoreOptions): StreamFn | undefined {
  if (options.streamFn) {
    return options.streamFn;
  }
  return undefined;
}

function createPiTools(
  toolExecutor: ToolExecutor,
  ctx: {
    runId: string;
    sessionId: string;
    runtimeMode: RuntimeMode;
  }
): AgentTool<any>[] {
  return PUBLIC_TOOL_NAMES.map((publicToolName) => ({
    name: toPiToolName(publicToolName),
    label: publicToolName,
    description: `OpenFoal tool: ${publicToolName}`,
    parameters: Type.Object({}, { additionalProperties: true }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      const result = await toolExecutor.execute(
        {
          name: publicToolName,
          args: (params ?? {}) as Record<string, unknown>
        },
        {
          runId: ctx.runId,
          sessionId: ctx.sessionId,
          runtimeMode: ctx.runtimeMode,
          toolCallId: typeof toolCallId === "string" ? toolCallId : undefined
        },
        {
          signal: signal as { aborted: boolean; addEventListener?: (...args: any[]) => void; removeEventListener?: (...args: any[]) => void } | undefined,
          onUpdate: (update) => {
            onUpdate?.({
              content: [
                {
                  type: "text",
                  text: update.delta
                }
              ],
              details: {
                at: update.at
              }
            });
          }
        }
      );

      if (!result.ok) {
        throw new Error(result.error?.message ?? "tool 执行失败");
      }

      return {
        content: [
          {
            type: "text",
            text: result.output ?? ""
          }
        ],
        details: {
          ok: true
        }
      };
    }
  }));
}

function toPiToolName(name: string): string {
  const sanitized = name.replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_");
  if (/^[A-Za-z]/.test(sanitized)) {
    return sanitized;
  }
  return `tool_${sanitized}`;
}

function toPublicToolName(piToolName: string): string {
  const matched = PUBLIC_TOOL_NAMES.find((name) => toPiToolName(name) === piToolName);
  return matched ?? piToolName;
}

function createConfiguredModel(
  provider: string,
  modelId: string,
  providerConfig: OpenFoalLlmProviderConfig | undefined,
  builtinModel: Model<any> | undefined
): Model<any> {
  const api = providerConfig?.api ?? builtinModel?.api ?? "openai-completions";
  const input = providerConfig?.input ?? builtinModel?.input ?? ["text"];
  const headers = mergeHeaders((builtinModel as Record<string, unknown> | undefined)?.headers, providerConfig?.headers);
  const baseUrl = firstNonEmpty(
    providerConfig?.baseUrl,
    asString((builtinModel as Record<string, unknown> | undefined)?.baseUrl)
  );
  const modelRecord: Record<string, unknown> = {
    id: modelId,
    name: builtinModel?.name ?? `${provider}/${modelId}`,
    api,
    provider,
    reasoning: providerConfig?.reasoning ?? builtinModel?.reasoning ?? false,
    input,
    cost: builtinModel?.cost ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    contextWindow: providerConfig?.contextWindow ?? builtinModel?.contextWindow ?? 128000,
    maxTokens: providerConfig?.maxTokens ?? builtinModel?.maxTokens ?? 16384
  };
  if (baseUrl) {
    modelRecord.baseUrl = baseUrl;
  }
  if (headers) {
    modelRecord.headers = headers;
  }
  return modelRecord as unknown as Model<any>;
}

function collectApiKeys(
  config: OpenFoalCoreConfig,
  env: EnvMap,
  explicitApiKey: string | undefined,
  activeProvider: string | undefined,
  activeModelApiKey: string | undefined
): Record<string, string> {
  const keys: Record<string, string> = {};
  const providers = config.llm?.providers ?? {};
  for (const [providerName, providerConfig] of Object.entries(providers)) {
    const key = firstNonEmpty(providerConfig.apiKey);
    if (key) {
      keys[providerName] = key;
    }
  }

  const models = config.llm?.models ?? {};
  for (const modelConfig of Object.values(models)) {
    const providerName = firstNonEmpty(modelConfig.provider);
    const key = firstNonEmpty(modelConfig.apiKey);
    if (providerName && key && !keys[providerName]) {
      keys[providerName] = key;
    }
  }

  const modelKey = firstNonEmpty(activeModelApiKey);
  if (modelKey) {
    if (activeProvider) {
      keys[activeProvider] = modelKey;
    } else {
      keys._default = modelKey;
    }
  }

  const explicit = firstNonEmpty(explicitApiKey, env.OPENFOAL_PI_API_KEY);
  if (explicit) {
    if (activeProvider) {
      keys[activeProvider] = explicit;
    } else {
      keys._default = explicit;
    }
  }

  return keys;
}

function resolveApiKey(provider: string, settings: PiRuntimeSettings, options: PiCoreOptions): string | undefined {
  const explicit = firstNonEmpty(options.apiKey, process.env.OPENFOAL_PI_API_KEY);
  if (explicit) {
    return explicit;
  }

  const configured = settings.apiKeys[provider] ?? settings.apiKeys._default;
  if (configured) {
    return configured;
  }

  const knownProviderKey = getEnvApiKey(provider);
  if (knownProviderKey) {
    return knownProviderKey;
  }

  const customEnvMap: Record<string, string> = {
    kimi: "KIMI_API_KEY",
    moonshot: "MOONSHOT_API_KEY",
    "kimi-coding": "KIMI_API_KEY"
  };
  const envName = customEnvMap[provider];
  const envValue = envName ? firstNonEmpty(process.env[envName]) : undefined;
  return envValue;
}

function mergeHeaders(
  base: unknown,
  override: Record<string, string> | undefined
): Record<string, string> | undefined {
  const baseRecord: Record<string, string> = {};
  if (isRecord(base)) {
    for (const [key, value] of Object.entries(base)) {
      if (typeof value === "string") {
        baseRecord[key] = value;
      }
    }
  }
  if (!override || Object.keys(override).length === 0) {
    return Object.keys(baseRecord).length > 0 ? baseRecord : undefined;
  }
  return { ...baseRecord, ...override };
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function mapPiEvent(event: AgentEvent, runId: string): CoreEvent[] {
  switch (event.type) {
    case "message_update": {
      const assistantEvent = event.assistantMessageEvent;
      if (assistantEvent.type === "text_delta") {
        return [
          {
            type: "delta",
            runId,
            text: assistantEvent.delta
          }
        ];
      }

      if (assistantEvent.type === "toolcall_start") {
        const call = extractToolCallFromPartial(runId, assistantEvent.partial, assistantEvent.contentIndex);
        if (!call) {
          return [];
        }
        return [
          {
            type: "tool_call_start",
            runId,
            toolCallId: call.toolCallId,
            toolName: call.toolName
          }
        ];
      }

      if (assistantEvent.type === "toolcall_delta") {
        const call = extractToolCallFromPartial(runId, assistantEvent.partial, assistantEvent.contentIndex);
        if (!call) {
          return [];
        }
        return [
          {
            type: "tool_call_delta",
            runId,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            delta: assistantEvent.delta
          }
        ];
      }

      if (assistantEvent.type === "toolcall_end") {
        return [
          {
            type: "tool_call",
            runId,
            toolCallId: resolveToolCallId(assistantEvent.toolCall.id, runId, assistantEvent.toolCall.name, "call"),
            toolName: toPublicToolName(assistantEvent.toolCall.name),
            args: isRecord(assistantEvent.toolCall.arguments) ? assistantEvent.toolCall.arguments : {}
          }
        ];
      }

      return [];
    }

    case "tool_execution_start":
      return [
        {
          type: "tool_result_start",
          runId,
          toolCallId: resolveToolCallId(event.toolCallId, runId, event.toolName, "result"),
          toolName: toPublicToolName(event.toolName)
        }
      ];

    case "tool_execution_update":
      return [
        {
          type: "tool_result_delta",
          runId,
          toolCallId: resolveToolCallId(event.toolCallId, runId, event.toolName, "result"),
          toolName: toPublicToolName(event.toolName),
          delta: extractToolExecutionDelta(event.partialResult)
        }
      ];

    case "tool_execution_end":
      return [
        {
          type: "tool_result",
          runId,
          toolCallId: resolveToolCallId(event.toolCallId, runId, event.toolName, "result"),
          toolName: toPublicToolName(event.toolName),
          output: extractToolExecutionOutput(event.result)
        }
      ];

    case "message_end":
      if (event.message.role === "assistant" && event.message.stopReason === "aborted") {
        return [
          {
            type: "failed",
            runId,
            code: "ABORTED",
            message: "Run aborted"
          }
        ];
      }
      if (event.message.role === "assistant" && event.message.stopReason === "error") {
        return [
          {
            type: "failed",
            runId,
            code: "MODEL_UNAVAILABLE",
            message: event.message.errorMessage ?? "model error"
          }
        ];
      }
      return [];

    default:
      return [];
  }
}

function extractToolCallFromPartial(
  runId: string,
  partial: unknown,
  contentIndex: number
): { toolCallId: string; toolName: string; args: Record<string, unknown> } | undefined {
  if (!partial || typeof partial !== "object") {
    return undefined;
  }
  const content = (partial as Record<string, unknown>).content;
  if (!Array.isArray(content) || contentIndex < 0 || contentIndex >= content.length) {
    return undefined;
  }
  const block = content[contentIndex];
  if (!block || typeof block !== "object") {
    return undefined;
  }
  const item = block as Record<string, unknown>;
  if (item.type !== "toolCall") {
    return undefined;
  }
  const toolName = typeof item.name === "string" && item.name.length > 0 ? item.name : "tool";
  return {
    toolCallId: resolveToolCallId(asString(item.id), runId, toolName, `idx_${contentIndex}`),
    toolName: toPublicToolName(toolName),
    args: isRecord(item.arguments) ? item.arguments : {}
  };
}

function resolveToolCallId(
  toolCallId: string | undefined,
  runId: string,
  toolName: string,
  suffix: string
): string {
  if (typeof toolCallId === "string" && toolCallId.trim().length > 0) {
    return toolCallId;
  }
  return `tc_${runId}_${sanitizeForId(toolName)}_${sanitizeForId(suffix)}`;
}

function sanitizeForId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_");
}

function extractLatestAssistantText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "assistant") {
      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (text.length > 0) {
        return text;
      }
    }
  }
  return "";
}

function extractToolExecutionOutput(result: unknown): string {
  if (!result || typeof result !== "object") {
    return "";
  }
  const content = (result as Record<string, unknown>).content;
  if (!Array.isArray(content)) {
    return "";
  }
  const lines = content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const record = item as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .filter((item) => item.length > 0);
  return lines.join("\n");
}

function extractToolExecutionDelta(partialResult: unknown): string {
  if (typeof partialResult === "string") {
    return partialResult;
  }
  if (!partialResult || typeof partialResult !== "object") {
    return "";
  }
  const content = (partialResult as Record<string, unknown>).content;
  if (Array.isArray(content)) {
    const lines = content
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const record = item as Record<string, unknown>;
        return record.type === "text" && typeof record.text === "string" ? record.text : "";
      })
      .filter((item) => item.length > 0);
    if (lines.length > 0) {
      return lines.join("\n");
    }
  }
  try {
    return JSON.stringify(partialResult);
  } catch {
    return "";
  }
}

function createRunState(runId: string, runStates: Map<string, RunState>, detachedAborts: Set<string>): RunState {
  const existing = runStates.get(runId);
  if (existing) {
    return existing;
  }
  const state: RunState = {
    aborted: detachedAborts.has(runId)
  };
  detachedAborts.delete(runId);
  runStates.set(runId, state);
  return state;
}

async function executeLegacyToolLoop(input: {
  runId: string;
  sessionId: string;
  runtimeMode: RuntimeMode;
  parsed: ParsedInput;
  state: RunState;
  toolExecutor: ToolExecutor;
}): Promise<{ events: CoreEvent[] }> {
  const events: CoreEvent[] = [];
  const outputParts: string[] = [];

  const baseText = input.parsed.text.trim();
  if (baseText.length > 0) {
    outputParts.push(baseText);
  }

  for (let index = 0; index < input.parsed.directives.length; index += 1) {
    const directive = input.parsed.directives[index];
    const toolCallId = `lc_${input.runId}_${index + 1}`;
    if (input.state.aborted) {
      events.push(makeAbortEvent(input.runId));
      return { events };
    }

    events.push({
      type: "tool_call_start",
      runId: input.runId,
      toolCallId,
      toolName: directive.name
    });
    events.push({
      type: "tool_call",
      runId: input.runId,
      toolCallId,
      toolName: directive.name,
      args: directive.args
    });
    events.push({
      type: "tool_result_start",
      runId: input.runId,
      toolCallId,
      toolName: directive.name
    });

    let result: ToolResult;
    const deltaParts: string[] = [];
    try {
      result = await input.toolExecutor.execute(
        {
          name: directive.name,
          args: directive.args
        },
        {
          runId: input.runId,
          sessionId: input.sessionId,
          runtimeMode: input.runtimeMode,
          toolCallId
        },
        {
          onUpdate: (update) => {
            if (!update.delta) {
              return;
            }
            deltaParts.push(update.delta);
            events.push({
              type: "tool_result_delta",
              runId: input.runId,
              toolCallId,
              toolName: directive.name,
              delta: update.delta
            });
          }
        }
      );
    } catch (error) {
      events.push({
        type: "failed",
        runId: input.runId,
        code: "TOOL_EXEC_FAILED",
        message: toErrorMessage(error)
      });
      return { events };
    }

    if (input.state.aborted) {
      events.push(makeAbortEvent(input.runId));
      return { events };
    }

    if (!result.ok) {
      events.push({
        type: "failed",
        runId: input.runId,
        code: result.error?.code ?? "TOOL_EXEC_FAILED",
        message: result.error?.message ?? "tool 执行失败"
      });
      return { events };
    }

    const output = result.output ?? "";
    events.push({
      type: "tool_result",
      runId: input.runId,
      toolCallId,
      toolName: directive.name,
      output: output.length > 0 ? output : deltaParts.join("")
    });

    outputParts.push(`${directive.name}: ${output.length > 0 ? output : deltaParts.join("")}`);
  }

  if (input.state.aborted) {
    events.push(makeAbortEvent(input.runId));
    return { events };
  }

  const finalOutput = outputParts.length > 0 ? outputParts.join("\n") : "(empty input)";
  events.push({
    type: "delta",
    runId: input.runId,
    text: finalOutput
  });
  events.push({
    type: "completed",
    runId: input.runId,
    output: finalOutput
  });

  return { events };
}

function parseInput(rawInput: string): { ok: true; data: ParsedInput } | { ok: false; error: string } {
  const directives: ParsedDirective[] = [];
  let stripped = rawInput;

  for (const match of rawInput.matchAll(TOOL_DIRECTIVE_PATTERN)) {
    const name = match[1];
    const rawArgs = match[2]?.trim();
    if (!name) {
      return {
        ok: false,
        error: "tool 指令缺少名称"
      };
    }

    if (!rawArgs) {
      directives.push({
        name,
        args: {}
      });
      stripped = stripped.replace(match[0], "");
      continue;
    }

    try {
      const parsed = JSON.parse(rawArgs);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {
          ok: false,
          error: `tool ${name} 参数必须是 JSON object`
        };
      }
      directives.push({
        name,
        args: parsed as Record<string, unknown>
      });
      stripped = stripped.replace(match[0], "");
    } catch (error) {
      return {
        ok: false,
        error: `tool ${name} 参数 JSON 解析失败: ${toErrorMessage(error)}`
      };
    }
  }

  return {
    ok: true,
    data: {
      text: stripped.trim(),
      directives
    }
  };
}

function makeAbortEvent(runId: string): CoreEvent {
  return {
    type: "failed",
    runId,
    code: "ABORTED",
    message: "Run aborted"
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class AsyncQueue<T> {
  private readonly queue: T[] = [];
  private readonly waiters: Array<(value: T | undefined) => void> = [];
  private done = false;

  push(value: T): void {
    if (this.done) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(value);
      return;
    }
    this.queue.push(value);
  }

  close(): void {
    if (this.done) {
      return;
    }
    this.done = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(undefined);
      }
    }
  }

  async next(): Promise<T | undefined> {
    if (this.queue.length > 0) {
      return this.queue.shift();
    }
    if (this.done) {
      return undefined;
    }
    return await new Promise<T | undefined>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
