export interface AbortSignalLike {
  aborted: boolean;
  addEventListener?(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener?(type: "abort", listener: () => void): void;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolContext {
  runId: string;
  sessionId: string;
  runtimeMode: "local" | "cloud";
  tenantId?: string;
  workspaceId?: string;
  userId?: string;
  workspaceRoot?: string;
  toolCallId?: string;
}

export interface ToolResult {
  ok: boolean;
  output?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface ToolExecutionHooks {
  onUpdate?: (update: { delta: string; at: string }) => void;
  signal?: AbortSignalLike;
}

export interface ToolExecutor {
  execute(call: ToolCall, ctx: ToolContext, hooks?: ToolExecutionHooks): Promise<ToolResult>;
}

export interface LocalToolExecutorOptions {
  workspaceRoot?: string;
  bashShell?: string;
  defaultTimeoutMs?: number;
}
