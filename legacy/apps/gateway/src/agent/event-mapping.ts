import type { CoreEvent } from "../../../../packages/core/dist/index.js";
import type { EventFrame } from "../../../../packages/protocol/dist/index.js";
import type { GatewayLlmOptions } from "./llm-resolution.js";

export function mapCoreEvent(coreEvent: CoreEvent): { event: EventFrame["event"]; payload: Record<string, unknown> } {
  switch (coreEvent.type) {
    case "accepted":
      return {
        event: "agent.accepted",
        payload: {
          runId: coreEvent.runId,
          sessionId: coreEvent.sessionId,
          runtimeMode: coreEvent.runtimeMode
        }
      };
    case "delta":
      return {
        event: "agent.delta",
        payload: {
          runId: coreEvent.runId,
          delta: coreEvent.text
        }
      };
    case "tool_call_start":
      return {
        event: "agent.tool_call_start",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
          toolName: coreEvent.toolName
        }
      };
    case "tool_call_delta":
      return {
        event: "agent.tool_call_delta",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
          toolName: coreEvent.toolName,
          delta: coreEvent.delta
        }
      };
    case "tool_call":
      return {
        event: "agent.tool_call",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
          toolName: coreEvent.toolName,
          args: coreEvent.args
        }
      };
    case "tool_result_start":
      return {
        event: "agent.tool_result_start",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
          toolName: coreEvent.toolName
        }
      };
    case "tool_result_delta":
      return {
        event: "agent.tool_result_delta",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
          toolName: coreEvent.toolName,
          delta: coreEvent.delta
        }
      };
    case "tool_result":
      return {
        event: "agent.tool_result",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
          toolName: coreEvent.toolName,
          output: coreEvent.output
        }
      };
    case "completed":
      return {
        event: "agent.completed",
        payload: {
          runId: coreEvent.runId,
          output: coreEvent.output
        }
      };
    case "failed":
      return {
        event: "agent.failed",
        payload: {
          runId: coreEvent.runId,
          code: coreEvent.code,
          message: coreEvent.message
        }
      };
    default:
      return assertNever(coreEvent);
  }
}

export function isHttpCompatibleRunEvent(eventName: EventFrame["event"]): boolean {
  return (
    eventName !== "agent.tool_call_start" &&
    eventName !== "agent.tool_call_delta" &&
    eventName !== "agent.tool_result_start" &&
    eventName !== "agent.tool_result_delta"
  );
}

export function toAcceptedLlmPayload(value: GatewayLlmOptions | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  const provider = asString(value.provider);
  const modelRef = asString(value.modelRef);
  const modelId = asString(value.modelId);
  const baseUrl = asString(value.baseUrl);
  const hasAny = Boolean(provider || modelRef || modelId || baseUrl);
  if (!hasAny) {
    return undefined;
  }
  return {
    ...(modelRef ? { modelRef } : {}),
    ...(provider ? { provider } : {}),
    ...(modelId ? { modelId } : {}),
    ...(baseUrl ? { baseUrl } : {})
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function assertNever(x: never): never {
  throw new Error(`Unexpected event: ${JSON.stringify(x)}`);
}
