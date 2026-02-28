import { type AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { ToolExecutor } from "../../../packages/tool-executor/dist/index.js";
import type { RuntimeMode } from "./shared.js";

export const PUBLIC_TOOL_NAMES = [
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

export function createPiTools(
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

export function toPiToolName(name: string): string {
  const sanitized = name.replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_");
  if (/^[A-Za-z]/.test(sanitized)) {
    return sanitized;
  }
  return `tool_${sanitized}`;
}

export function toPublicToolName(piToolName: string): string {
  const matched = PUBLIC_TOOL_NAMES.find((name) => toPiToolName(name) === piToolName);
  return matched ?? piToolName;
}
