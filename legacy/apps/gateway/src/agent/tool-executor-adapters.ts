import type {
  ExecutionTargetRecord,
  PolicyDecision,
  PolicyRecord,
  PolicyRepository
} from "../../../../packages/storage/dist/index.js";
import type {
  ToolCall,
  ToolContext,
  ToolExecutionHooks,
  ToolExecutor,
  ToolResult
} from "../../../../packages/tool-executor/dist/index.js";
import type { DockerRunnerInvoker } from "./execution-target.js";

const HIGH_RISK_TOOLS = new Set(["bash.exec", "http.request", "file.write", "memory.appendDaily"]);

export function resolveToolDecision(policy: PolicyRecord, toolName: string): PolicyDecision {
  const exact = policy.tools[toolName];
  if (exact) {
    return exact;
  }
  if (HIGH_RISK_TOOLS.has(toolName)) {
    return policy.highRisk;
  }
  return policy.toolDefault;
}

export function createPolicyAwareToolExecutor(input: {
  base: ToolExecutor;
  policyRepo: PolicyRepository;
}): ToolExecutor {
  return {
    async execute(call, ctx, hooks): Promise<ToolResult> {
      const policy = await input.policyRepo.get({
        tenantId: ctx.tenantId ?? "t_default",
        workspaceId: ctx.workspaceId ?? "w_default",
        scopeKey: "default"
      });
      const decision = resolveToolDecision(policy, call.name);

      if (decision === "deny") {
        return {
          ok: false,
          error: {
            code: "POLICY_DENIED",
            message: `策略拒绝执行工具: ${call.name}`
          }
        };
      }

      return await input.base.execute(call, ctx, hooks);
    }
  };
}

export function createExecutionTargetToolExecutor(input: {
  local: ToolExecutor;
  dockerRunnerInvoker: DockerRunnerInvoker;
  getExecutionTarget: (sessionId: string) => ExecutionTargetRecord | undefined;
  getToolScope?: (sessionId: string) => { tenantId: string; workspaceId: string; userId: string; workspaceRoot?: string } | undefined;
}): ToolExecutor {
  return {
    async execute(call: ToolCall, ctx: ToolContext, hooks?: ToolExecutionHooks): Promise<ToolResult> {
      const toolScope = input.getToolScope?.(ctx.sessionId);
      const scopedCtx: ToolContext = {
        ...ctx,
        ...(toolScope
          ? {
              tenantId: toolScope.tenantId,
              workspaceId: toolScope.workspaceId,
              userId: toolScope.userId,
              ...(toolScope.workspaceRoot ? { workspaceRoot: toolScope.workspaceRoot } : {})
            }
          : {})
      };
      const target = input.getExecutionTarget(ctx.sessionId);
      if (!target || target.kind === "local-host") {
        return await input.local.execute(call, scopedCtx, hooks);
      }
      return await input.dockerRunnerInvoker({
        target,
        call,
        ctx: scopedCtx,
        hooks
      });
    }
  };
}
