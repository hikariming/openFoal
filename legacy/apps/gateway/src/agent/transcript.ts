import type { EventFrame } from "../../../../packages/protocol/dist/index.js";
import type { SessionRecord, TranscriptRepository } from "../../../../packages/storage/dist/index.js";

const TRANSCRIPT_KEY_EVENT_NAMES = new Set<EventFrame["event"]>([
  "agent.accepted",
  "agent.delta",
  "agent.tool_call_start",
  "agent.tool_call_delta",
  "agent.tool_call",
  "agent.tool_result_start",
  "agent.tool_result_delta",
  "agent.tool_result",
  "agent.completed",
  "agent.failed"
]);

export async function persistTranscript(
  session: SessionRecord,
  transcriptRepo: TranscriptRepository,
  runId: string | undefined,
  events: EventFrame[],
  now: () => Date
): Promise<void> {
  for (const event of filterEventsForTranscript(events)) {
    await transcriptRepo.append({
      sessionId: session.id,
      tenantId: session.tenantId,
      workspaceId: session.workspaceId,
      ownerUserId: session.ownerUserId,
      event: event.event,
      payload: event.payload,
      createdAt: now().toISOString(),
      ...(runId ? { runId } : {})
    });
  }
}

export function filterEventsForTranscript(events: EventFrame[]): EventFrame[] {
  return events.filter((event) => TRANSCRIPT_KEY_EVENT_NAMES.has(event.event));
}
