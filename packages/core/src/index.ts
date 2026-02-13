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
