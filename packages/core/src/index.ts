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

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolContext {
  runId: string;
  sessionId: string;
  runtimeMode: RuntimeMode;
}

export interface ToolResult {
  ok: boolean;
  output?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface ToolExecutor {
  execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult>;
}

export interface RuntimeCoreOptions {
  toolExecutor?: ToolExecutor;
}

interface RunState {
  aborted: boolean;
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

export function createRuntimeCoreService(options: RuntimeCoreOptions = {}): CoreService {
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

        const outcome = await executeToolLoop({
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
        const outcome = await executeToolLoop({
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
  return {
    async execute(call: ToolCall): Promise<ToolResult> {
      switch (call.name) {
        case "math.add": {
          const a = asFiniteNumber(call.args.a);
          const b = asFiniteNumber(call.args.b);
          if (a === undefined || b === undefined) {
            return {
              ok: false,
              error: {
                code: "TOOL_EXEC_FAILED",
                message: "math.add 需要数值参数 a/b"
              }
            };
          }
          return {
            ok: true,
            output: String(a + b)
          };
        }

        case "text.upper": {
          const text = typeof call.args.text === "string" ? call.args.text : "";
          return {
            ok: true,
            output: text.toUpperCase()
          };
        }

        case "echo": {
          const text = typeof call.args.text === "string" ? call.args.text : JSON.stringify(call.args);
          return {
            ok: true,
            output: text
          };
        }

        default:
          return {
            ok: false,
            error: {
              code: "TOOL_EXEC_FAILED",
              message: `未知工具: ${call.name}`
            }
          };
      }
    }
  };
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

async function executeToolLoop(input: {
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

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number") {
    return undefined;
  }
  return Number.isFinite(value) ? value : undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
