import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { CoreEvent } from "./shared.js";
import {
  asString,
  extractToolExecutionDelta,
  extractToolExecutionOutput,
  isRecord,
  resolveToolCallId
} from "./shared.js";
import { toPublicToolName } from "./pi-tools.js";

export function mapPiEvent(event: AgentEvent, runId: string): CoreEvent[] {
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
