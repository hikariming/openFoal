import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_BOOTSTRAP_FILES,
  DEFAULT_BOOTSTRAP_MAX_CHARS,
  DEFAULT_SYSTEM_PROMPT,
  resolveWorkspaceRoot,
  type PiCoreOptions
} from "./shared.js";

const CONTEXT_DIR = ".openfoal/context";

export function buildSystemPromptWithWorkspace(options: PiCoreOptions): string {
  const basePrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
  const ensureFiles = options.ensureBootstrapFiles !== false;
  const maxChars = Number.isFinite(Number(options.bootstrapMaxChars))
    ? Math.max(500, Math.floor(Number(options.bootstrapMaxChars)))
    : DEFAULT_BOOTSTRAP_MAX_CHARS;

  if (ensureFiles) {
    ensureWorkspaceBootstrapFiles(workspaceRoot);
  }

  const files = loadWorkspaceBootstrapFiles(workspaceRoot, maxChars);
  if (files.length === 0) {
    return basePrompt;
  }

  const lines: string[] = [basePrompt, "", "## Project Context"];
  lines.push(
    "Follow workspace guidance files. Security/policy/system constraints always take precedence over style/persona rules."
  );
  lines.push(
    "Memory recall rule: only when the question is about prior work, decisions, dates, preferences, or todos not already present in this chat, run memory.search first, then use memory.get for exact lines."
  );
  lines.push(
    "URL follow-up rule: when the user gives a URL or asks to continue/check/load a just-mentioned URL, call http.request first with extract:'readable', followRedirects:true (and increase timeoutMs/maxBodyChars when needed)."
  );
  lines.push(
    "Do not call file.list/file.read or memory.search for website questions unless the user explicitly asks about local files or memory notes."
  );
  lines.push(
    "Current chat history is primary context. For questions like '我刚刚问了什么' or '总结一下刚才内容', answer from this session history directly instead of memory.search."
  );
  lines.push("");
  for (const file of files) {
    lines.push(`### ${file.name}`);
    lines.push(file.content);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function ensureWorkspaceBootstrapFiles(workspaceRoot: string): void {
  const contextRoot = join(workspaceRoot, CONTEXT_DIR);
  mkdirSync(contextRoot, { recursive: true });
  for (const fileName of DEFAULT_BOOTSTRAP_FILES) {
    const filePath = join(contextRoot, fileName);
    if (existsSync(filePath)) {
      continue;
    }
    writeFileSync(filePath, defaultBootstrapContent(fileName), {
      encoding: "utf8",
      flag: "wx"
    });
  }
}

function loadWorkspaceBootstrapFiles(
  workspaceRoot: string,
  maxChars: number
): Array<{ name: string; content: string }> {
  const items: Array<{ name: string; content: string }> = [];
  for (const fileName of DEFAULT_BOOTSTRAP_FILES) {
    const scopedFilePath = join(workspaceRoot, CONTEXT_DIR, fileName);
    const legacyFilePath = join(workspaceRoot, fileName);
    const filePath = existsSync(scopedFilePath)
      ? scopedFilePath
      : existsSync(legacyFilePath)
        ? legacyFilePath
        : undefined;
    if (!filePath) {
      continue;
    }
    try {
      const raw = readFileSync(filePath, "utf8");
      items.push({
        name: fileName,
        content: truncateBootstrapContent(raw, maxChars, fileName)
      });
    } catch {
      // ignore unreadable context file
    }
  }
  return items;
}

function truncateBootstrapContent(content: string, maxChars: number, fileName: string): string {
  if (content.length <= maxChars) {
    return content;
  }
  const head = content.slice(0, Math.floor(maxChars * 0.75));
  const tail = content.slice(content.length - Math.floor(maxChars * 0.2));
  return `${head}\n\n[...truncated, read ${fileName} for full content...]\n\n${tail}`;
}

function defaultBootstrapContent(fileName: (typeof DEFAULT_BOOTSTRAP_FILES)[number]): string {
  switch (fileName) {
    case "AGENTS.md":
      return "# AGENTS.md\n\n- Follow project coding and safety policies.\n- Keep responses concise and executable.\n";
    case "SOUL.md":
      return "# SOUL.md\n\nPragmatic, direct engineering assistant persona.\n";
    case "TOOLS.md":
      return "# TOOLS.md\n\n- Prefer workspace-safe tools.\n- Explain side effects before destructive actions.\n";
    case "USER.md":
      return "# USER.md\n\n- Preferred language: zh-CN\n- Style: concise and practical\n";
    default:
      return "";
  }
}
