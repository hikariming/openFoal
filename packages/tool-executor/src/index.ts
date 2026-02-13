export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolContext {
  runId: string;
  sessionId: string;
  runtimeMode: "local" | "cloud";
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
