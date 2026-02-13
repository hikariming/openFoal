import {
  createLocalToolExecutor,
  type ToolExecutor,
  type ToolResult
} from "../../../packages/tool-executor/dist/index.js";
import { Agent, type AgentEvent, type AgentTool, type StreamFn } from "@mariozechner/pi-agent-core";
import {
  Type,
  createAssistantMessageEventStream,
  getModel,
  registerBuiltInApiProviders,
  type AssistantMessage,
  type Context,
  type Message,
  type Model
} from "@mariozechner/pi-ai";

declare const process: any;

export type RuntimeMode = "local" | "cloud";

export interface CoreRunInput {
  sessionId: string;
  input: string;
  runtimeMode: RuntimeMode;
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
      type: "tool_call";
      runId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      runId: string;
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
  provider?: string;
  modelId?: string;
  systemPrompt?: string;
  streamMode?: "real" | "mock";
  streamFn?: StreamFn;
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
        const streamFn = resolvePiStreamFn(piOptions);
        const tools = createPiTools(toolExecutor, {
          runId,
          sessionId: input.sessionId,
          runtimeMode: input.runtimeMode
        });

        const agent = new Agent({
          initialState: {
            ...(resolvePiModel(piOptions) ? { model: resolvePiModel(piOptions) as Model<any> } : {}),
            systemPrompt: piOptions.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
            tools
          },
          streamFn,
          getApiKey: (provider) => resolveApiKey(provider),
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

export function createMockCoreService(): CoreService {
  const abortedRunIds = new Set<string>();
  let runCounter = 0;

  return {
    async *run(input: CoreRunInput): AsyncIterable<CoreEvent> {
      const runId = `run_${++runCounter}`;

      yield {
        type: "accepted",
        runId,
        sessionId: input.sessionId,
        runtimeMode: input.runtimeMode
      };

      if (abortedRunIds.has(runId)) {
        yield {
          type: "failed",
          runId,
          code: "ABORTED",
          message: "Run was aborted before generation"
        };
        return;
      }

      yield {
        type: "delta",
        runId,
        text: `Echo(${input.runtimeMode}): `
      };

      if (abortedRunIds.has(runId)) {
        yield {
          type: "failed",
          runId,
          code: "ABORTED",
          message: "Run was aborted during generation"
        };
        return;
      }

      const output = input.input.trim() || "(empty input)";
      yield {
        type: "delta",
        runId,
        text: output
      };

      yield {
        type: "completed",
        runId,
        output
      };
    },

    async *continue(input: CoreContinueInput): AsyncIterable<CoreEvent> {
      yield {
        type: "delta",
        runId: input.runId,
        text: `Continue: ${input.input}`
      };

      yield {
        type: "completed",
        runId: input.runId,
        output: input.input
      };
    },

    async abort(runId: string): Promise<void> {
      abortedRunIds.add(runId);
    }
  };
}

export function createBuiltinToolExecutor(): ToolExecutor {
  return createLocalToolExecutor();
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
  return "pi";
}

function ensurePiProviders(): void {
  if (piProvidersRegistered) {
    return;
  }
  registerBuiltInApiProviders();
  piProvidersRegistered = true;
}

function resolvePiModel(options: PiCoreOptions): Model<any> | undefined {
  ensurePiProviders();

  const provider = options.provider ?? process.env.OPENFOAL_PI_PROVIDER;
  const modelId = options.modelId ?? process.env.OPENFOAL_PI_MODEL;
  if (provider && modelId) {
    try {
      return getModel(provider as any, modelId as any);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function resolvePiStreamFn(options: PiCoreOptions): StreamFn | undefined {
  if (options.streamFn) {
    return options.streamFn;
  }

  const mode = options.streamMode ?? process.env.OPENFOAL_PI_STREAM_MODE ?? "mock";
  if (mode === "mock") {
    return createPiMockStreamFn();
  }
  return undefined;
}

function createPiMockStreamFn(): StreamFn {
  return (model, context) => {
    const stream = createAssistantMessageEventStream();

    void (async () => {
      const finalMessage = buildMockAssistantMessage(model, context);
      let partial = createAssistantMessageSkeleton(model);

      stream.push({
        type: "start",
        partial: cloneAssistant(partial)
      });

      for (const block of finalMessage.content) {
        const contentIndex = partial.content.length;
        if (block.type === "text") {
          partial = {
            ...partial,
            content: [...partial.content, { type: "text", text: "" }]
          };
          stream.push({
            type: "text_start",
            contentIndex,
            partial: cloneAssistant(partial)
          });

          partial = {
            ...partial,
            content: partial.content.map((item, index) =>
              index === contentIndex ? { type: "text", text: block.text } : item
            )
          };
          stream.push({
            type: "text_delta",
            contentIndex,
            delta: block.text,
            partial: cloneAssistant(partial)
          });
          stream.push({
            type: "text_end",
            contentIndex,
            content: block.text,
            partial: cloneAssistant(partial)
          });
          continue;
        }

        if (block.type === "toolCall") {
          partial = {
            ...partial,
            content: [
              ...partial.content,
              {
                type: "toolCall",
                id: block.id,
                name: block.name,
                arguments: {}
              }
            ]
          };
          stream.push({
            type: "toolcall_start",
            contentIndex,
            partial: cloneAssistant(partial)
          });

          partial = {
            ...partial,
            content: partial.content.map((item, index) =>
              index === contentIndex
                ? {
                    type: "toolCall",
                    id: block.id,
                    name: block.name,
                    arguments: block.arguments
                  }
                : item
            )
          };
          stream.push({
            type: "toolcall_delta",
            contentIndex,
            delta: JSON.stringify(block.arguments),
            partial: cloneAssistant(partial)
          });
          stream.push({
            type: "toolcall_end",
            contentIndex,
            toolCall: block,
            partial: cloneAssistant(partial)
          });
        }
      }

      stream.push({
        type: "done",
        reason: finalMessage.stopReason === "toolUse" ? "toolUse" : "stop",
        message: finalMessage
      });
    })().catch((error) => {
      const failure = createAssistantMessageSkeleton(model);
      failure.stopReason = "error";
      failure.errorMessage = toErrorMessage(error);
      stream.push({
        type: "error",
        reason: "error",
        error: failure
      });
    });

    return stream;
  };
}

function buildMockAssistantMessage(model: Model<any>, context: Context): AssistantMessage {
  const lastMessage = context.messages[context.messages.length - 1];
  if (!lastMessage) {
    return makeAssistantMessage(model, [{ type: "text", text: "(empty context)" }], "stop");
  }

  if (lastMessage.role === "toolResult") {
    const trailing = collectTrailingToolResults(context.messages);
    const lines = trailing.map((item) => `${item.toolName}: ${extractToolResultContent(item)}`);
    return makeAssistantMessage(
      model,
      [{ type: "text", text: lines.length > 0 ? lines.join("\n") : "(tool results)" }],
      "stop"
    );
  }

  const userText = extractMessageText(lastMessage);
  const parsed = parseInput(userText);
  if (!parsed.ok) {
    return makeAssistantMessage(model, [{ type: "text", text: parsed.error }], "stop");
  }

  const content: AssistantMessage["content"] = [];
  if (parsed.data.text.length > 0) {
    content.push({
      type: "text",
      text: parsed.data.text
    });
  }

  if (parsed.data.directives.length > 0) {
    for (let i = 0; i < parsed.data.directives.length; i += 1) {
      const directive = parsed.data.directives[i];
      content.push({
        type: "toolCall",
        id: `tc_${Date.now()}_${i + 1}`,
        name: directive.name,
        arguments: directive.args
      });
    }
    return makeAssistantMessage(model, content, "toolUse");
  }

  return makeAssistantMessage(model, [{ type: "text", text: parsed.data.text || "(empty input)" }], "stop");
}

function createAssistantMessageSkeleton(model: Model<any>): AssistantMessage {
  return makeAssistantMessage(model, [], "stop");
}

function makeAssistantMessage(
  model: Model<any>,
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"]
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0
      }
    },
    stopReason,
    timestamp: Date.now()
  };
}

function createPiTools(
  toolExecutor: ToolExecutor,
  ctx: {
    runId: string;
    sessionId: string;
    runtimeMode: RuntimeMode;
  }
): AgentTool<any>[] {
  const toolNames = [
    "bash.exec",
    "file.read",
    "file.write",
    "file.list",
    "http.request",
    "math.add",
    "text.upper",
    "echo"
  ];

  return toolNames.map((toolName) => ({
    name: toolName,
    label: toolName,
    description: `OpenFoal tool: ${toolName}`,
    parameters: Type.Object({}, { additionalProperties: true }),
    execute: async (_toolCallId, params) => {
      const result = await toolExecutor.execute(
        {
          name: toolName,
          args: (params ?? {}) as Record<string, unknown>
        },
        {
          runId: ctx.runId,
          sessionId: ctx.sessionId,
          runtimeMode: ctx.runtimeMode
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

function resolveApiKey(provider: string): string | undefined {
  const explicit = process.env.OPENFOAL_PI_API_KEY;
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return explicit.trim();
  }

  const map: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GOOGLE_API_KEY",
    "google-vertex": "GOOGLE_VERTEX_API_KEY",
    "amazon-bedrock": "AWS_BEDROCK_API_KEY",
    xai: "XAI_API_KEY",
    groq: "GROQ_API_KEY",
    cerebras: "CEREBRAS_API_KEY",
    mistral: "MISTRAL_API_KEY",
    minimax: "MINIMAX_API_KEY",
    "minimax-cn": "MINIMAX_API_KEY",
    openrouter: "OPENROUTER_API_KEY"
  };
  const envName = map[provider];
  if (!envName) {
    return undefined;
  }
  const value = process.env[envName];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function mapPiEvent(event: AgentEvent, runId: string): CoreEvent[] {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        return [
          {
            type: "delta",
            runId,
            text: event.assistantMessageEvent.delta
          }
        ];
      }
      return [];

    case "tool_execution_start":
      return [
        {
          type: "tool_call",
          runId,
          toolName: event.toolName,
          args: isRecord(event.args) ? event.args : {}
        }
      ];

    case "tool_execution_end":
      return [
        {
          type: "tool_result",
          runId,
          toolName: event.toolName,
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

function collectTrailingToolResults(messages: Message[]): Array<Extract<Message, { role: "toolResult" }>> {
  const results: Array<Extract<Message, { role: "toolResult" }>> = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "toolResult") {
      break;
    }
    results.push(message);
  }
  return results.reverse();
}

function extractToolResultContent(message: Extract<Message, { role: "toolResult" }>): string {
  return message.content
    .map((item) => (item.type === "text" ? item.text : ""))
    .filter((item) => item.length > 0)
    .join("\n");
}

function extractMessageText(message: Message): string {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return message.content;
    }
    return message.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
  }
  if (message.role === "assistant") {
    return message.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
  }
  return extractToolResultContent(message);
}

function cloneAssistant(message: AssistantMessage): AssistantMessage {
  return JSON.parse(JSON.stringify(message)) as AssistantMessage;
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

  for (const directive of input.parsed.directives) {
    if (input.state.aborted) {
      events.push(makeAbortEvent(input.runId));
      return { events };
    }

    events.push({
      type: "tool_call",
      runId: input.runId,
      toolName: directive.name,
      args: directive.args
    });

    let result: ToolResult;
    try {
      result = await input.toolExecutor.execute(
        {
          name: directive.name,
          args: directive.args
        },
        {
          runId: input.runId,
          sessionId: input.sessionId,
          runtimeMode: input.runtimeMode
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
      toolName: directive.name,
      output
    });

    outputParts.push(`${directive.name}: ${output}`);
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
