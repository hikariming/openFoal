// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { resolve, sep } from "node:path";
import type { ToolCall, ToolContext } from "./types.js";
import { readNonEmptyString } from "./utils.js";

declare const process: any;

export function resolveEffectiveWorkspaceRoot(baseWorkspaceRoot: string, call: ToolCall, ctx: ToolContext): string {
  const explicitWorkspaceRoot = readNonEmptyString(ctx.workspaceRoot);
  if (explicitWorkspaceRoot) {
    return normalizePath(resolve(explicitWorkspaceRoot));
  }
  const namespaceRoot = resolveEnterpriseNamespaceRoot(baseWorkspaceRoot, call, ctx);
  return namespaceRoot ?? baseWorkspaceRoot;
}

function resolveEnterpriseNamespaceRoot(
  baseWorkspaceRoot: string,
  call: ToolCall,
  ctx: ToolContext
): string | undefined {
  const args = call.args;
  const namespace = readNamespace(args.namespace) ?? (isScopedNamespaceTool(call.name) ? "user" : undefined);
  if (!namespace) {
    return undefined;
  }
  const tenantId = sanitizeScopeSegment(readNonEmptyString(args.tenantId) ?? ctx.tenantId);
  const workspaceId = sanitizeScopeSegment(readNonEmptyString(args.workspaceId) ?? ctx.workspaceId);
  const userId = sanitizeScopeSegment(readNonEmptyString(args.userId) ?? ctx.userId);
  if (!tenantId || !workspaceId) {
    return undefined;
  }
  if (namespace === "user" && !userId) {
    return undefined;
  }
  const storageRoot = normalizePath(
    resolve(readNonEmptyString(process.env?.OPENFOAL_ENTERPRISE_STORAGE_ROOT) ?? baseWorkspaceRoot)
  );
  const resourceType = readResourceType(args.resourceType, call.name);
  const resourceSegment = resourceType === "memory" ? "memory" : "files";
  const scopedRoot =
    namespace === "workspace"
      ? resolve(storageRoot, "tenants", tenantId, "workspaces", workspaceId, "shared", resourceSegment)
      : resolve(storageRoot, "tenants", tenantId, "workspaces", workspaceId, "users", userId!, resourceSegment);
  return normalizePath(scopedRoot);
}

function isScopedNamespaceTool(toolName: string): boolean {
  return toolName.startsWith("memory.") || toolName.startsWith("file.");
}

function readNamespace(value: unknown): "user" | "workspace" | undefined {
  if (value === "user" || value === "workspace") {
    return value;
  }
  return undefined;
}

function readResourceType(value: unknown, toolName: string): "memory" | "files" {
  if (value === "memory" || value === "files") {
    return value;
  }
  return toolName.startsWith("memory.") ? "memory" : "files";
}

function sanitizeScopeSegment(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : undefined;
}

export function resolveDailyMemoryPath(args: Record<string, unknown>, date: string): string {
  void args;
  return `.openfoal/memory/daily/${date}.md`;
}

export function resolveLegacyDailyMemoryPath(args: Record<string, unknown>, date: string): string {
  const namespace = readNamespace(args.namespace);
  if (namespace) {
    return `daily/${date}.md`;
  }
  return `memory/${date}.md`;
}

export function resolveLongTermMemoryPath(): string {
  return ".openfoal/memory/MEMORY.md";
}

export function resolveLegacyLongTermMemoryPath(): string {
  return "MEMORY.md";
}

export function resolveSafePath(
  workspaceRoot: string,
  inputPath: string
): { ok: true; value: string } | { ok: false; message: string } {
  const absolute = normalizePath(resolve(workspaceRoot, inputPath));
  const root = normalizePath(workspaceRoot);
  if (absolute === root || absolute.startsWith(`${root}${sep}`) || absolute.startsWith(`${root}/`)) {
    return { ok: true, value: absolute };
  }
  return { ok: false, message: `路径越界: ${inputPath}` };
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}
