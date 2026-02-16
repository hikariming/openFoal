import type { AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";
import type { Message, Model } from "@mariozechner/pi-ai";
import { resolve } from "node:path";
import type { ToolExecutor } from "../../../packages/tool-executor/dist/index.js";
import type {
  EnvMap,
  OpenFoalCoreConfig,
  OpenFoalLlmModelConfig,
  OpenFoalLlmProviderConfig
} from "./config.js";

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

export interface RunState {
  aborted: boolean;
}

export interface ActiveRun {
  aborted: boolean;
  agent?: {
    continue(): Promise<void>;
    abort(): void;
    state: { messages: Message[] };
  };
}

export interface ParsedDirective {
  name: string;
  args: Record<string, unknown>;
}

export interface ParsedInput {
  text: string;
  directives: ParsedDirective[];
}

export const TOOL_DIRECTIVE_PATTERN = /\[\[tool:([a-zA-Z0-9._-]+)(?:\s+([\s\S]*?))?\]\]/g;
export const DEFAULT_SYSTEM_PROMPT = "You are OpenFoal assistant.";
export const DEFAULT_BOOTSTRAP_MAX_CHARS = 8_000;
export const DEFAULT_BOOTSTRAP_FILES = ["AGENTS.md", "SOUL.md", "TOOLS.md", "USER.md"] as const;
export const MAX_SESSION_CONTEXT_MESSAGES = 120;

export function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function cloneAgentMessages(messages: AgentMessage[]): AgentMessage[] {
  try {
    return JSON.parse(JSON.stringify(messages)) as AgentMessage[];
  } catch {
    return [...messages];
  }
}

export function trimSessionMessages(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length <= MAX_SESSION_CONTEXT_MESSAGES) {
    return messages;
  }
  return messages.slice(-MAX_SESSION_CONTEXT_MESSAGES);
}

export function sanitizeForId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_");
}

export function resolveToolCallId(
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

export function extractLatestAssistantText(messages: Message[]): string {
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

export function extractToolExecutionOutput(result: unknown): string {
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

export function extractToolExecutionDelta(partialResult: unknown): string {
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

export class AsyncQueue<T> {
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

export function createRunState(runId: string, runStates: Map<string, RunState>, detachedAborts: Set<string>): RunState {
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

export function resolveWorkspaceRoot(input: string | undefined): string {
  const explicit = firstNonEmpty(input, process.env.OPENFOAL_WORKSPACE_ROOT);
  if (explicit) {
    return resolve(explicit);
  }
  return resolve(process.cwd());
}

export type { EnvMap, OpenFoalCoreConfig, OpenFoalLlmModelConfig, OpenFoalLlmProviderConfig };
