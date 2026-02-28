import type { CoreService, RuntimeMode } from "../../../../packages/core/dist/index.js";
import { makeErrorRes, makeSuccessRes, type EventFrame, type ReqFrame, type ResFrame } from "../../../../packages/protocol/dist/index.js";
import type {
  AgentRepository,
  AuditRepository,
  BudgetRepository,
  ExecutionTargetRecord,
  ExecutionTargetRepository,
  MetricsRepository,
  ModelSecretRepository,
  SessionRecord,
  SessionRepository,
  TranscriptRepository
} from "../../../../packages/storage/dist/index.js";
import type { ToolExecutor } from "../../../../packages/tool-executor/dist/index.js";
import { isHttpCompatibleRunEvent, mapCoreEvent, toAcceptedLlmPayload } from "./event-mapping.js";
import {
  createLocalFallbackExecutionTarget,
  probeExecutionTargetAvailability,
  resolveCloudFailurePolicy,
  resolveExecutionTarget,
  type CloudFailurePolicy
} from "./execution-target.js";
import { resolveRunLlmOptions } from "./llm-resolution.js";
import { estimateContextUsage, prepareSessionForRun } from "./session-prep.js";
import { persistTranscript } from "./transcript.js";

export async function handleAgentRun(input: {
  req: ReqFrame;
  state: {
    runningSessionIds: Set<string>;
    queuedModeChanges: Map<string, RuntimeMode>;
    principal?: {
      displayName?: string;
      tenantId: string;
      workspaceIds: string[];
      roles: string[];
      userId?: string;
      subject?: string;
    };
    nextSeq: number;
    stateVersion: number;
  };
  coreService: CoreService;
  sessionRepo: SessionRepository;
  transcriptRepo: TranscriptRepository;
  agentRepo: AgentRepository;
  executionTargetRepo: ExecutionTargetRepository;
  budgetRepo: BudgetRepository;
  auditRepo: AuditRepository;
  modelSecretRepo: ModelSecretRepository;
  metricsRepo: MetricsRepository;
  internalToolExecutor: ToolExecutor;
  sessionExecutionTargets: Map<string, ExecutionTargetRecord>;
  sessionToolScopes: Map<string, { tenantId: string; workspaceId: string; userId: string; workspaceRoot?: string }>;
  enableCloudProbe: boolean;
  now: () => Date;
  options: {
    transport?: "http" | "ws";
    onEvent?: (event: EventFrame) => void;
  };
  helpers: {
    requireString: (params: Record<string, unknown>, key: string) => string | undefined;
    asRuntimeMode: (value: unknown) => RuntimeMode | undefined;
    asLlmOptions: (value: unknown) => {
      modelRef?: string;
      provider?: string;
      modelId?: string;
      apiKey?: string;
      baseUrl?: string;
    } | undefined;
    resolveSessionOwnerUserId: (params: Record<string, unknown>, state: any) => string;
    canReadCrossUserSessions: (principal: any) => boolean;
    resolvePrincipalUserId: (principal: any) => string;
    resolveSessionVisibility: (params: Record<string, unknown>, state: any) => "private" | "workspace";
    createSession: (input: {
      id: string;
      runtimeMode: RuntimeMode;
      title?: string;
      preview?: string;
      tenantId: string;
      workspaceId: string;
      ownerUserId: string;
      visibility: "private" | "workspace";
    }) => SessionRecord;
    resolveBudgetScopeKey: (params: Record<string, unknown>, tenantId: string, workspaceId: string, agentId: string) => string;
    getBudgetExceededReason: (
      policy: {
        tokenDailyLimit: number | null;
        costMonthlyUsdLimit: number | null;
        hardLimit: boolean;
      },
      usage: {
        tokensUsedDaily: number;
        costUsdMonthly: number;
      }
    ) => string | undefined;
    withSessionInput: (session: SessionRecord, input: string) => SessionRecord;
    createEvent: (state: any, event: EventFrame["event"], payload: Record<string, unknown>) => EventFrame;
    estimateRunUsage: (input: string, output: string) => { tokensUsed: number; costUsd: number };
    isObjectRecord: (value: unknown) => value is Record<string, unknown>;
  };
}): Promise<{ response: ResFrame; events: EventFrame[] }> {
  const { req, state } = input;
  const requireString = input.helpers.requireString;
  const sessionId = requireString(req.params, "sessionId");
  const runInput = requireString(req.params, "input");
  const rawUserInput = requireString(req.params, "rawInput") ?? runInput;
  const reqRuntimeMode = input.helpers.asRuntimeMode(req.params.runtimeMode);
  const requestedLlm = input.helpers.asLlmOptions(req.params.llm);
  const tenantId = requireString(req.params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
  const workspaceId = requireString(req.params, "workspaceId") ?? state.principal?.workspaceIds[0] ?? "w_default";
  const agentId = requireString(req.params, "agentId") ?? "a_default";
  const actor =
    requireString(req.params, "actor") ??
    state.principal?.displayName ??
    (state.principal ? input.helpers.resolvePrincipalUserId(state.principal) : undefined) ??
    "user";
  const ownerUserId = input.helpers.resolveSessionOwnerUserId(req.params, state);
  const sessionScope = {
    tenantId,
    workspaceId,
    ...(input.helpers.canReadCrossUserSessions(state.principal) ? {} : { ownerUserId })
  };
  const explicitTargetId = requireString(req.params, "executionTargetId");
  if (!sessionId || !runInput) {
    return {
      response: makeErrorRes(req.id, "INVALID_REQUEST", "agent.run 需要 sessionId 和 input"),
      events: []
    };
  }

  if (state.runningSessionIds.has(sessionId)) {
    return {
      response: makeErrorRes(req.id, "SESSION_BUSY", `会话 ${sessionId} 正在运行`),
      events: []
    };
  }

  let selectedTarget = await resolveExecutionTarget({
    tenantId,
    workspaceId,
    agentId,
    explicitTargetId,
    agentRepo: input.agentRepo,
    executionTargetRepo: input.executionTargetRepo
  });
  if (!selectedTarget) {
    return {
      response: makeErrorRes(req.id, "INVALID_REQUEST", "未找到可用执行目标"),
      events: []
    };
  }
  if (!selectedTarget.enabled) {
    return {
      response: makeErrorRes(req.id, "POLICY_DENIED", `执行目标不可用: ${selectedTarget.targetId}`),
      events: []
    };
  }
  let fallbackApplied = false;
  let fallbackReason = "";
  let fallbackFromTargetId: string | undefined;
  let cloudFailurePolicy: CloudFailurePolicy = "deny";
  if (selectedTarget.kind === "docker-runner" && input.enableCloudProbe) {
    cloudFailurePolicy = resolveCloudFailurePolicy(req.params, selectedTarget.config, requireString, input.helpers.isObjectRecord);
    const availability = await probeExecutionTargetAvailability(selectedTarget);
    if (!availability.ok) {
      fallbackReason = availability.reason ?? "cloud target unreachable";
      if (cloudFailurePolicy === "fallback_local") {
        fallbackApplied = true;
        fallbackFromTargetId = selectedTarget.targetId;
        selectedTarget = createLocalFallbackExecutionTarget({
          tenantId,
          workspaceId,
          sourceTargetId: selectedTarget.targetId,
          now: input.now
        });
        await input.auditRepo.append({
          tenantId,
          workspaceId,
          action: "execution.mode_changed",
          actor,
          resourceType: "session",
          resourceId: sessionId,
          metadata: {
            runtimeMode: "local",
            executionMode: "local_sandbox",
            status: "fallback-local",
            reason: fallbackReason,
            fromTargetId: fallbackFromTargetId,
            toTargetId: selectedTarget.targetId
          },
          createdAt: input.now().toISOString()
        });
      } else {
        await input.auditRepo.append({
          tenantId,
          workspaceId,
          action: "execution.mode_changed",
          actor,
          resourceType: "session",
          resourceId: sessionId,
          metadata: {
            runtimeMode: "cloud",
            executionMode: "enterprise_cloud",
            status: "cloud-unreachable-denied",
            reason: fallbackReason,
            targetId: selectedTarget.targetId
          },
          createdAt: input.now().toISOString()
        });
        return {
          response: makeErrorRes(req.id, "MODEL_UNAVAILABLE", `企业云执行目标不可达: ${fallbackReason}`),
          events: []
        };
      }
    }
  }

  const budgetScopeKey = input.helpers.resolveBudgetScopeKey(req.params, tenantId, workspaceId, agentId);
  const budgetPolicy = await input.budgetRepo.get(budgetScopeKey);
  const budgetUsage = await input.budgetRepo.summary(budgetScopeKey);
  const budgetExceededReason = input.helpers.getBudgetExceededReason(budgetPolicy, budgetUsage);
  if (budgetExceededReason) {
    await input.budgetRepo.addUsage({
      scopeKey: budgetScopeKey,
      runsRejected: 1,
      date: input.now().toISOString().slice(0, 10)
    });
    await input.auditRepo.append({
      tenantId,
      workspaceId,
      action: "budget.rejected",
      actor,
      resourceType: "budget_policy",
      resourceId: budgetScopeKey,
      metadata: {
        reason: budgetExceededReason,
        usage: budgetUsage,
        policy: budgetPolicy
      },
      createdAt: input.now().toISOString()
    });
    return {
      response: makeErrorRes(req.id, "POLICY_DENIED", `预算超限: ${budgetExceededReason}`),
      events: []
    };
  }

  let session = await input.sessionRepo.get(sessionId, sessionScope);
  if (!session) {
    const existingSession = await input.sessionRepo.get(sessionId, {
      tenantId,
      workspaceId
    });
    if (existingSession) {
      return {
        response: makeErrorRes(req.id, "FORBIDDEN", `会话 ${sessionId} 无访问权限`),
        events: []
      };
    }
    session = input.helpers.createSession({
      id: sessionId,
      runtimeMode: reqRuntimeMode ?? "local",
      tenantId,
      workspaceId,
      ownerUserId,
      visibility: input.helpers.resolveSessionVisibility(req.params, state)
    });
    await input.sessionRepo.upsert(session);
  }

  if (reqRuntimeMode && reqRuntimeMode !== session.runtimeMode) {
    const updated = await input.sessionRepo.setRuntimeMode(sessionId, reqRuntimeMode, sessionScope);
    if (updated) {
      session = updated;
    }
  }

  const llm = await resolveRunLlmOptions({
    requested: requestedLlm,
    principal: state.principal as any,
    preferSecretConfig: Boolean(state.principal),
    tenantId,
    workspaceId,
    modelSecretRepo: input.modelSecretRepo
  });

  session = await prepareSessionForRun({
    sessionRepo: input.sessionRepo,
    toolExecutor: input.internalToolExecutor,
    session,
    scope: sessionScope,
    toolContext: {
      tenantId: session.tenantId,
      workspaceId: session.workspaceId,
      userId: session.ownerUserId
    },
    input: rawUserInput ?? runInput,
    now: input.now
  });

  const allEvents: EventFrame[] = [];
  const responseEvents: EventFrame[] = [];
  const runStartedAt = Date.now();
  let runStatus: "completed" | "failed" = "completed";
  let toolCallsTotal = 0;
  let toolFailures = 0;
  let completedOutput = "";
  let acceptedRunId = "";
  const runtimeModeForRun: RuntimeMode = selectedTarget.kind === "docker-runner" ? "cloud" : "local";
  const emit = (event: EventFrame): void => {
    allEvents.push(event);
    input.options.onEvent?.(event);
    if ((input.options.transport ?? "http") === "http" && isHttpCompatibleRunEvent(event.event)) {
      responseEvents.push(event);
    }
  };
  if (fallbackApplied) {
    emit(
      input.helpers.createEvent(state, "runtime.mode_changed", {
        sessionId,
        runtimeMode: "local",
        executionMode: "local_sandbox",
        status: "fallback-local",
        reason: fallbackReason,
        fromTargetId: fallbackFromTargetId,
        toTargetId: selectedTarget.targetId
      })
    );
  }

  await input.transcriptRepo.append({
    sessionId,
    tenantId: session.tenantId,
    workspaceId: session.workspaceId,
    ownerUserId: session.ownerUserId,
    event: "user.input",
    payload: { input: rawUserInput ?? runInput },
    createdAt: input.now().toISOString()
  });

  const sessionWithInput = input.helpers.withSessionInput(session, rawUserInput ?? runInput);
  if (sessionWithInput.title !== session.title || sessionWithInput.preview !== session.preview) {
    await input.sessionRepo.upsert(sessionWithInput);
    const refreshed = await input.sessionRepo.get(sessionId, sessionScope);
    session = refreshed ?? sessionWithInput;
    emit(input.helpers.createEvent(state, "session.updated", { session }));
  }

  state.runningSessionIds.add(sessionId);
  input.sessionExecutionTargets.set(sessionId, selectedTarget);
  input.sessionToolScopes.set(sessionId, {
    tenantId: session.tenantId,
    workspaceId: session.workspaceId,
    userId: session.ownerUserId
  });
  try {
    for await (const coreEvent of input.coreService.run({
      sessionId,
      input: runInput,
      runtimeMode: runtimeModeForRun,
      ...(llm ? { llm } : {})
    })) {
      const mapped = mapCoreEvent(coreEvent);
      if (mapped.event === "agent.accepted") {
        const acceptedLlm = toAcceptedLlmPayload(llm);
        if (acceptedLlm) {
          mapped.payload = {
            ...mapped.payload,
            llm: acceptedLlm
          };
        }
        const runId = mapped.payload.runId;
        if (typeof runId === "string") {
          acceptedRunId = runId;
        }
      } else if (mapped.event === "agent.tool_call") {
        toolCallsTotal += 1;
      } else if (mapped.event === "agent.failed") {
        runStatus = "failed";
        toolFailures += 1;
      } else if (mapped.event === "agent.completed") {
        completedOutput = typeof mapped.payload.output === "string" ? mapped.payload.output : "";
      }
      emit(input.helpers.createEvent(state, mapped.event, mapped.payload));
    }
  } finally {
    state.runningSessionIds.delete(sessionId);
    input.sessionExecutionTargets.delete(sessionId);
    input.sessionToolScopes.delete(sessionId);
  }

  const queuedMode = state.queuedModeChanges.get(sessionId);
  if (queuedMode) {
    state.queuedModeChanges.delete(sessionId);
    const updated = await input.sessionRepo.setRuntimeMode(sessionId, queuedMode, sessionScope);
    if (updated) {
      emit(
        input.helpers.createEvent(state, "runtime.mode_changed", {
          sessionId,
          runtimeMode: queuedMode,
          status: "applied"
        })
      );
      emit(input.helpers.createEvent(state, "session.updated", { session: updated }));
    }
  }

  if (!acceptedRunId) {
    await input.metricsRepo.recordRun({
      sessionId,
      tenantId,
      workspaceId,
      agentId,
      status: "failed",
      durationMs: Date.now() - runStartedAt,
      toolCalls: toolCallsTotal,
      toolFailures: Math.max(1, toolFailures),
      createdAt: input.now().toISOString()
    });
    await persistTranscript(session, input.transcriptRepo, undefined, allEvents, input.now);
    return {
      response: makeErrorRes(req.id, "INTERNAL_ERROR", "agent.run 未返回 runId"),
      events: responseEvents
    };
  }

  const finalUsage = estimateContextUsage(session.contextUsage, runInput, completedOutput);
  await input.sessionRepo.updateMeta(sessionId, {
    contextUsage: finalUsage
  }, sessionScope);

  await input.metricsRepo.recordRun({
    sessionId,
    runId: acceptedRunId,
    tenantId,
    workspaceId,
    agentId,
    status: runStatus,
    durationMs: Date.now() - runStartedAt,
    toolCalls: toolCallsTotal,
    toolFailures,
    createdAt: input.now().toISOString()
  });

  const usageSnapshot = input.helpers.estimateRunUsage(runInput, completedOutput);
  await input.budgetRepo.addUsage({
    scopeKey: budgetScopeKey,
    date: input.now().toISOString().slice(0, 10),
    tokensUsed: usageSnapshot.tokensUsed,
    costUsd: usageSnapshot.costUsd
  });

  await input.auditRepo.append({
    tenantId,
    workspaceId,
    action: runStatus === "completed" ? "agent.run.completed" : "agent.run.failed",
    actor,
    resourceType: "run",
    resourceId: acceptedRunId,
    metadata: {
      sessionId,
      agentId,
      runtimeMode: runtimeModeForRun,
      executionTargetId: selectedTarget.targetId,
      executionTargetKind: selectedTarget.kind,
      fallbackApplied,
      ...(fallbackFromTargetId ? { fallbackFromTargetId } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
      ...(selectedTarget.kind === "docker-runner" ? { cloudFailurePolicy } : {}),
      toolCallsTotal,
      toolFailures,
      budgetScopeKey,
      usageSnapshot
    },
    createdAt: input.now().toISOString()
  });

  await persistTranscript(session, input.transcriptRepo, acceptedRunId, allEvents, input.now);

  return {
    response: makeSuccessRes(req.id, {
      runId: acceptedRunId,
      status: "accepted"
    }),
    events: responseEvents
  };
}
