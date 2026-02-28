import { createLocalToolExecutor, type ToolResult } from "../../../packages/tool-executor/dist/index.js";
import {
  TOOL_DIRECTIVE_PATTERN,
  createRunState,
  toErrorMessage,
  type CoreContinueInput,
  type CoreEvent,
  type CoreRunInput,
  type CoreService,
  type ParsedInput,
  type RunState,
  type RuntimeCoreOptions
} from "./shared.js";

export function createLegacyRuntimeCoreService(options: RuntimeCoreOptions = {}): CoreService {
  const toolExecutor = options.toolExecutor ?? createLocalToolExecutor();
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

async function executeLegacyToolLoop(input: {
  runId: string;
  sessionId: string;
  runtimeMode: "local" | "cloud";
  parsed: ParsedInput;
  state: RunState;
  toolExecutor: {
    execute(
      call: { name: string; args: Record<string, unknown> },
      ctx: { runId: string; sessionId: string; runtimeMode: "local" | "cloud"; toolCallId?: string },
      hooks?: { onUpdate?: (update: { delta: string; at: string }) => void }
    ): Promise<ToolResult>;
  };
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
  const directives: Array<{ name: string; args: Record<string, unknown> }> = [];
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
