import type { SessionRecord, SessionRepository } from "../../../../packages/storage/dist/index.js";
import type { ToolExecutor } from "../../../../packages/tool-executor/dist/index.js";

const PRE_COMPACTION_THRESHOLD = 0.85;

export async function prepareSessionForRun(input: {
  sessionRepo: SessionRepository;
  toolExecutor: ToolExecutor;
  session: SessionRecord;
  scope: {
    tenantId: string;
    workspaceId: string;
    ownerUserId?: string;
  };
  toolContext: {
    tenantId: string;
    workspaceId: string;
    userId: string;
  };
  input: string;
  now: () => Date;
}): Promise<SessionRecord> {
  let current = input.session;
  const projectedUsage = estimateContextUsage(current.contextUsage, input.input);
  const initialMeta = await input.sessionRepo.updateMeta(current.id, {
    contextUsage: projectedUsage,
    memoryFlushState: projectedUsage >= PRE_COMPACTION_THRESHOLD ? "pending" : "idle"
  }, input.scope);
  if (initialMeta) {
    current = initialMeta;
  }

  if (projectedUsage < PRE_COMPACTION_THRESHOLD) {
    return current;
  }

  let flushState: "flushed" | "skipped" = "skipped";
  try {
    const flush = await input.toolExecutor.execute(
      {
        name: "memory.appendDaily",
        args: {
          content: `[NO_REPLY] pre-compaction session=${current.id} ${summarizeForMemory(input.input)}`,
          includeLongTerm: false,
          namespace: "user",
          tenantId: input.toolContext.tenantId,
          workspaceId: input.toolContext.workspaceId,
          userId: input.toolContext.userId
        }
      },
      {
        runId: `flush_${Date.now().toString(36)}`,
        sessionId: current.id,
        runtimeMode: current.runtimeMode,
        tenantId: input.toolContext.tenantId,
        workspaceId: input.toolContext.workspaceId,
        userId: input.toolContext.userId
      }
    );
    flushState = flush.ok ? "flushed" : "skipped";
  } catch {
    flushState = "skipped";
  }

  const flushedMeta = await input.sessionRepo.updateMeta(current.id, {
    memoryFlushState: flushState,
    ...(flushState === "flushed"
      ? {
          memoryFlushAt: input.now().toISOString(),
          compactionCount: current.compactionCount + 1,
          contextUsage: Math.max(0.35, projectedUsage - 0.45)
        }
      : {})
  }, input.scope);
  if (flushedMeta) {
    current = flushedMeta;
  }
  return current;
}

export function summarizeForMemory(input: string): string {
  const compact = input.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "(empty input)";
  }
  return compact.slice(0, 320);
}

export function estimateContextUsage(current: number, inputText: string, outputText = ""): number {
  const base = Number.isFinite(current) ? Math.max(0, Math.min(1, current)) : 0;
  const delta = Math.min(0.45, (inputText.length + outputText.length) / 12_000);
  return Math.min(1, Number((base + delta).toFixed(6)));
}
