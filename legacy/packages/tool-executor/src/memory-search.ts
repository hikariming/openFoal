// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { spawnSync } from "node:child_process";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { createHash } from "node:crypto";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { dirname, resolve } from "node:path";

declare const process: any;

type SearchMode = "hybrid" | "keyword" | "contains";
type EmbeddingProviderName = "openai" | "gemini" | "voyage";

type SearchHit = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  source: "memory";
};

type SearchResponse = {
  results: Array<Omit<SearchHit, "id">>;
  mode: SearchMode;
  provider?: EmbeddingProviderName;
  model?: string;
  indexStats: {
    files: number;
    chunks: number;
    lastSyncAt?: string;
  };
};

type ToolResultLike = {
  ok: boolean;
  output?: string;
  error?: {
    code: string;
    message: string;
  };
};

type IndexedFile = {
  relPath: string;
  text: string;
  hash: string;
};

type ChunkRecord = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  chunkHash: string;
};

type IndexStats = {
  files: number;
  chunks: number;
  lastSyncAt?: string;
  ftsAvailable: boolean;
};

type ProviderConfig = {
  provider: EmbeddingProviderName;
  model: string;
};

const INDEX_PATH = ".openfoal/memory/index.sqlite";
const CHUNK_WINDOW_LINES = 20;
const CHUNK_OVERLAP_LINES = 5;
const DEFAULT_MAX_RESULTS = 6;
const DEFAULT_MIN_SCORE = 0.25;
const MAX_RESULTS_LIMIT = 20;
const SNIPPET_MAX_CHARS = 700;
const HYBRID_VECTOR_WEIGHT = 0.7;
const HYBRID_KEYWORD_WEIGHT = 0.3;
const EMBEDDING_DIMS = 64;

export function executeMemorySearch(args: Record<string, unknown>, workspaceRoot: string): ToolResultLike {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (query.length === 0) {
    return fail("memory.search 需要 query");
  }

  const maxResults = clampInt(args.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS_LIMIT);
  const minScore = clampNumber(args.minScore, DEFAULT_MIN_SCORE, 0, 1);

  if (!isMemorySearchEnabled()) {
    return success({
      results: [],
      mode: "contains",
      indexStats: {
        files: 0,
        chunks: 0
      }
    });
  }

  const dbPath = resolve(workspaceRoot, INDEX_PATH);
  const provider = resolveEmbeddingProvider();
  let firstError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const stats = syncMemoryIndex(workspaceRoot, dbPath);
      const keyword = searchKeyword({
        dbPath,
        query,
        limit: Math.max(maxResults * 4, maxResults),
        ftsAvailable: stats.ftsAvailable
      });

      let finalResults: SearchHit[] = keyword.results;
      let mode: SearchMode = keyword.mode;

      if (provider) {
        const vectors = searchVector({
          dbPath,
          query,
          provider,
          limit: Math.max(maxResults * 4, maxResults)
        });
        finalResults = mergeHybridResults(keyword.results, vectors, maxResults, minScore);
        mode = "hybrid";
      } else {
        finalResults = applyScoreFilter(keyword.results, maxResults, minScore);
      }

      const response: SearchResponse = {
        results: finalResults.map((item) => ({
          path: item.path,
          startLine: item.startLine,
          endLine: item.endLine,
          snippet: item.snippet,
          score: item.score,
          source: "memory"
        })),
        mode,
        ...(provider ? { provider: provider.provider, model: provider.model } : {}),
        indexStats: {
          files: stats.files,
          chunks: stats.chunks,
          ...(stats.lastSyncAt ? { lastSyncAt: stats.lastSyncAt } : {})
        }
      };
      return success(response);
    } catch (error) {
      if (attempt === 0) {
        firstError = error;
        resetCorruptedIndex(dbPath);
        continue;
      }
      const fallback = searchContainsWithoutIndex(workspaceRoot, query, maxResults);
      const response: SearchResponse = {
        results: fallback.results.map((item) => ({
          path: item.path,
          startLine: item.startLine,
          endLine: item.endLine,
          snippet: item.snippet,
          score: item.score,
          source: "memory"
        })),
        mode: "contains",
        indexStats: {
          files: fallback.files,
          chunks: fallback.chunks
        }
      };
      if (firstError) {
        // keep behavior non-fatal, but make fallback visible in logs.
        logDebug(`memory.search fallback to contains: ${toErrorMessage(firstError)}`);
      }
      return success(response);
    }
  }

  return fail("memory.search 执行失败");
}

function syncMemoryIndex(workspaceRoot: string, dbPath: string): IndexStats {
  mkdirSync(dirname(dbPath), { recursive: true });
  ensureSchema(dbPath);
  const ftsAvailable = ensureFtsTable(dbPath);
  const now = nowIso();

  const indexedFiles = listMemoryFiles(workspaceRoot);
  const existing = queryJson<{ path: string; hash: string }>(
    dbPath,
    "SELECT path, hash FROM files;"
  );
  const existingMap = new Map<string, string>();
  for (const row of existing) {
    if (typeof row.path === "string" && typeof row.hash === "string") {
      existingMap.set(row.path, row.hash);
    }
  }

  for (const file of indexedFiles) {
    if (existingMap.get(file.relPath) === file.hash) {
      continue;
    }
    upsertFileChunks(dbPath, file, now, ftsAvailable);
  }

  const incomingPaths = new Set(indexedFiles.map((file) => file.relPath));
  for (const existingPath of existingMap.keys()) {
    if (incomingPaths.has(existingPath)) {
      continue;
    }
    deleteFileChunks(dbPath, existingPath, ftsAvailable);
  }

  setMeta(dbPath, "last_sync_at", now);

  const fileCount = querySingleNumber(dbPath, "SELECT COUNT(1) AS count FROM files;");
  const chunkCount = querySingleNumber(dbPath, "SELECT COUNT(1) AS count FROM chunks;");
  const lastSyncAt = readMeta(dbPath, "last_sync_at");
  return {
    files: fileCount,
    chunks: chunkCount,
    ...(lastSyncAt ? { lastSyncAt } : {}),
    ftsAvailable
  };
}

function upsertFileChunks(dbPath: string, file: IndexedFile, now: string, ftsAvailable: boolean): void {
  const chunks = buildChunks(file.relPath, file.text);
  const statements: string[] = ["BEGIN;"];

  if (ftsAvailable) {
    statements.push(
      `DELETE FROM chunks_fts WHERE id IN (SELECT id FROM chunks WHERE path = ${sqlString(file.relPath)});`
    );
  }
  statements.push(`DELETE FROM chunks WHERE path = ${sqlString(file.relPath)};`);

  for (const chunk of chunks) {
    statements.push(
      `INSERT OR REPLACE INTO chunks (id, path, start_line, end_line, text, chunk_hash) VALUES (` +
        `${sqlString(chunk.id)}, ${sqlString(chunk.path)}, ${String(chunk.startLine)}, ${String(chunk.endLine)}, ` +
        `${sqlString(chunk.text)}, ${sqlString(chunk.chunkHash)});`
    );
    if (ftsAvailable) {
      statements.push(
        `INSERT INTO chunks_fts (id, text) VALUES (${sqlString(chunk.id)}, ${sqlString(chunk.text)});`
      );
    }
  }

  statements.push(
    `INSERT OR REPLACE INTO files (path, hash, line_count, updated_at) VALUES (` +
      `${sqlString(file.relPath)}, ${sqlString(file.hash)}, ${String(countLines(file.text))}, ${sqlString(now)});`
  );
  statements.push("COMMIT;");
  execSql(dbPath, statements.join("\n"));
}

function deleteFileChunks(dbPath: string, relPath: string, ftsAvailable: boolean): void {
  const statements: string[] = ["BEGIN;"];
  if (ftsAvailable) {
    statements.push(
      `DELETE FROM chunks_fts WHERE id IN (SELECT id FROM chunks WHERE path = ${sqlString(relPath)});`
    );
  }
  statements.push(`DELETE FROM chunks WHERE path = ${sqlString(relPath)};`);
  statements.push(`DELETE FROM files WHERE path = ${sqlString(relPath)};`);
  statements.push("COMMIT;");
  execSql(dbPath, statements.join("\n"));
}

function searchKeyword(input: {
  dbPath: string;
  query: string;
  limit: number;
  ftsAvailable: boolean;
}): {
  mode: "keyword" | "contains";
  results: SearchHit[];
} {
  if (input.ftsAvailable) {
    const tokens = tokenize(input.query).slice(0, 8);
    if (tokens.length > 0) {
      const ftsQuery = tokens.map((token) => `${token.replace(/"/g, "\"\"")}*`).join(" OR ");
      try {
        const rows = queryJson<{ id: string; path: string; startLine: number; endLine: number; text: string }>(
          input.dbPath,
          `SELECT c.id AS id, c.path AS path, c.start_line AS startLine, c.end_line AS endLine, c.text AS text\n` +
            `FROM chunks_fts f\n` +
            `JOIN chunks c ON c.id = f.id\n` +
            `WHERE chunks_fts MATCH ${sqlString(ftsQuery)}\n` +
            `LIMIT ${String(input.limit)};`
        );
        if (rows.length > 0) {
          const total = rows.length;
          const mapped = rows.map((row, index) => ({
            id: String(row.id),
            path: String(row.path),
            startLine: toPositiveLine(row.startLine),
            endLine: toPositiveLine(row.endLine),
            snippet: clipSnippet(String(row.text)),
            score: roundScore(1 - index / (total + 1)),
            source: "memory" as const
          }));
          return {
            mode: "keyword",
            results: mapped
          };
        }
      } catch {
        // ignore FTS errors and fallback to contains.
      }
    }
  }

  const needle = input.query.toLowerCase();
  const escaped = needle.replace(/'/g, "''");
  const rows = queryJson<{ id: string; path: string; startLine: number; endLine: number; text: string }>(
    input.dbPath,
    `SELECT id, path, start_line AS startLine, end_line AS endLine, text\n` +
      `FROM chunks\n` +
      `WHERE lower(text) LIKE '%${escaped}%'\n` +
      `LIMIT ${String(input.limit)};`
  );

  const mapped = rows.map((row) => {
    const text = String(row.text);
    const hitCount = countOccurrences(text.toLowerCase(), needle);
    const density = hitCount > 0 ? Math.min(1, hitCount / Math.max(1, needle.length / 6)) : 0;
    const score = roundScore(0.25 + density * 0.6);
    return {
      id: String(row.id),
      path: String(row.path),
      startLine: toPositiveLine(row.startLine),
      endLine: toPositiveLine(row.endLine),
      snippet: clipSnippet(text),
      score,
      source: "memory" as const
    };
  });

  return {
    mode: "contains",
    results: mapped
  };
}

function searchVector(input: {
  dbPath: string;
  query: string;
  provider: ProviderConfig;
  limit: number;
}): SearchHit[] {
  const queryVec = embedText(input.query);
  const chunks = queryJson<{
    id: string;
    path: string;
    startLine: number;
    endLine: number;
    text: string;
    chunkHash: string;
  }>(
    input.dbPath,
    "SELECT id, path, start_line AS startLine, end_line AS endLine, text, chunk_hash AS chunkHash FROM chunks;"
  );

  const cachedRows = queryJson<{ chunkHash: string; vectorJson: string }>(
    input.dbPath,
    `SELECT chunk_hash AS chunkHash, vector_json AS vectorJson\n` +
      `FROM embeddings\n` +
      `WHERE provider = ${sqlString(input.provider.provider)} AND model = ${sqlString(input.provider.model)};`
  );

  const cached = new Map<string, number[]>();
  for (const row of cachedRows) {
    const parsed = parseVector(row.vectorJson);
    if (parsed.length > 0) {
      cached.set(String(row.chunkHash), parsed);
    }
  }

  const inserts: string[] = [];
  const scored = chunks.map((chunk) => {
    const hash = String(chunk.chunkHash);
    let vec = cached.get(hash);
    if (!vec) {
      vec = embedText(String(chunk.text));
      cached.set(hash, vec);
      inserts.push(
        `INSERT OR REPLACE INTO embeddings (chunk_hash, provider, model, vector_json, updated_at) VALUES (` +
          `${sqlString(hash)}, ${sqlString(input.provider.provider)}, ${sqlString(input.provider.model)}, ` +
          `${sqlString(JSON.stringify(vec))}, ${sqlString(nowIso())});`
      );
    }
    const cosine = cosineSimilarity(queryVec, vec);
    const score = roundScore((cosine + 1) / 2);
    return {
      id: String(chunk.id),
      path: String(chunk.path),
      startLine: toPositiveLine(chunk.startLine),
      endLine: toPositiveLine(chunk.endLine),
      snippet: clipSnippet(String(chunk.text)),
      score,
      source: "memory" as const
    };
  });

  if (inserts.length > 0) {
    execSql(input.dbPath, ["BEGIN;", ...inserts, "COMMIT;"].join("\n"));
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit);
}

function mergeHybridResults(
  keywordResults: SearchHit[],
  vectorResults: SearchHit[],
  maxResults: number,
  minScore: number
): SearchHit[] {
  const merged = new Map<string, SearchHit & { keywordScore: number; vectorScore: number }>();

  for (const item of keywordResults) {
    merged.set(item.id, {
      ...item,
      keywordScore: item.score,
      vectorScore: 0
    });
  }
  for (const item of vectorResults) {
    const existing = merged.get(item.id);
    if (existing) {
      existing.vectorScore = item.score;
      existing.score = roundScore(existing.vectorScore * HYBRID_VECTOR_WEIGHT + existing.keywordScore * HYBRID_KEYWORD_WEIGHT);
      continue;
    }
    merged.set(item.id, {
      ...item,
      keywordScore: 0,
      vectorScore: item.score,
      score: roundScore(item.score * HYBRID_VECTOR_WEIGHT)
    });
  }

  const ordered = Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .map((item) => ({
      id: item.id,
      path: item.path,
      startLine: item.startLine,
      endLine: item.endLine,
      snippet: item.snippet,
      score: item.score,
      source: "memory" as const
    }));

  return applyScoreFilter(ordered, maxResults, minScore);
}

function applyScoreFilter(results: SearchHit[], maxResults: number, minScore: number): SearchHit[] {
  const filtered = results.filter((item) => item.score >= minScore).slice(0, maxResults);
  if (filtered.length > 0) {
    return filtered;
  }
  return results.slice(0, maxResults);
}

function ensureSchema(dbPath: string): void {
  execSql(
    dbPath,
    `
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        line_count INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        text TEXT NOT NULL,
        chunk_hash TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
      CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(chunk_hash);

      CREATE TABLE IF NOT EXISTS embeddings (
        chunk_hash TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        vector_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (chunk_hash, provider, model)
      );

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `
  );
}

function ensureFtsTable(dbPath: string): boolean {
  if (hasFtsTable(dbPath)) {
    return true;
  }
  try {
    execSql(
      dbPath,
      `
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
        USING fts5(id, text);
      `
    );
  } catch {
    return false;
  }
  return hasFtsTable(dbPath);
}

function hasFtsTable(dbPath: string): boolean {
  const rows = queryJson<{ name: string }>(
    dbPath,
    "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts';"
  );
  return rows.length > 0;
}

function setMeta(dbPath: string, key: string, value: string): void {
  execSql(
    dbPath,
    `INSERT OR REPLACE INTO meta (key, value) VALUES (${sqlString(key)}, ${sqlString(value)});`
  );
}

function readMeta(dbPath: string, key: string): string | undefined {
  const rows = queryJson<{ value: string }>(
    dbPath,
    `SELECT value FROM meta WHERE key = ${sqlString(key)} LIMIT 1;`
  );
  if (rows.length === 0) {
    return undefined;
  }
  const value = rows[0]?.value;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function querySingleNumber(dbPath: string, sql: string): number {
  const rows = queryJson<{ count: number }>(dbPath, sql);
  const value = rows[0]?.count;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function listMemoryFiles(workspaceRoot: string): IndexedFile[] {
  const selected = new Map<string, { file: IndexedFile; priority: number }>();

  addMemoryFileCandidate(selected, workspaceRoot, ".openfoal/memory/MEMORY.md", 3);
  addMemoryFileCandidate(selected, workspaceRoot, "MEMORY.md", 2);
  collectMarkdownFiles(selected, workspaceRoot, ".openfoal/memory/daily", 3);
  collectMarkdownFiles(selected, workspaceRoot, "memory", 2);
  collectMarkdownFiles(selected, workspaceRoot, "daily", 1);

  return Array.from(selected.values())
    .map((entry) => entry.file)
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function collectMarkdownFiles(
  out: Map<string, { file: IndexedFile; priority: number }>,
  workspaceRoot: string,
  dirName: string,
  priority: number
): void {
  const dir = resolve(workspaceRoot, dirName);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return;
  }
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!/^[A-Za-z0-9._-]+\.md$/.test(entry.name)) {
      continue;
    }
    addMemoryFileCandidate(out, workspaceRoot, `${dirName}/${entry.name}`, priority);
  }
}

function addMemoryFileCandidate(
  out: Map<string, { file: IndexedFile; priority: number }>,
  workspaceRoot: string,
  relPath: string,
  priority: number
): void {
  const canonicalPath = canonicalizeMemoryPath(relPath);
  if (!canonicalPath) {
    return;
  }
  const absPath = resolve(workspaceRoot, relPath);
  if (!existsSync(absPath) || !statSync(absPath).isFile()) {
    return;
  }
  const existing = out.get(canonicalPath);
  if (existing && existing.priority > priority) {
    return;
  }
  const text = readFileSync(absPath, "utf8");
  out.set(canonicalPath, {
    file: {
      relPath: canonicalPath,
      text,
      hash: sha256(text)
    },
    priority
  });
}

function canonicalizeMemoryPath(relPath: string): string | undefined {
  if (relPath === ".openfoal/memory/MEMORY.md" || relPath === "MEMORY.md") {
    return ".openfoal/memory/MEMORY.md";
  }
  const dailyNew = /^\.openfoal\/memory\/daily\/([A-Za-z0-9._/-]+\.md)$/.exec(relPath);
  if (dailyNew?.[1]) {
    return `.openfoal/memory/daily/${dailyNew[1]}`;
  }
  const dailyLegacy = /^(?:memory|daily)\/([A-Za-z0-9._/-]+\.md)$/.exec(relPath);
  if (dailyLegacy?.[1]) {
    return `.openfoal/memory/daily/${dailyLegacy[1]}`;
  }
  return undefined;
}

function buildChunks(relPath: string, text: string): ChunkRecord[] {
  const lines = text.split(/\r?\n/);
  const chunks: ChunkRecord[] = [];
  const step = Math.max(1, CHUNK_WINDOW_LINES - CHUNK_OVERLAP_LINES);

  for (let start = 0; start < lines.length; start += step) {
    const slice = lines.slice(start, start + CHUNK_WINDOW_LINES);
    if (slice.length === 0) {
      break;
    }
    const chunkText = slice.join("\n").trim();
    if (chunkText.length === 0) {
      if (start + CHUNK_WINDOW_LINES >= lines.length) {
        break;
      }
      continue;
    }
    const startLine = start + 1;
    const endLine = start + slice.length;
    const chunkHash = sha256(chunkText);
    const id = sha256(`${relPath}:${String(startLine)}:${String(endLine)}:${chunkHash}`).slice(0, 32);
    chunks.push({
      id,
      path: relPath,
      startLine,
      endLine,
      text: chunkText,
      chunkHash
    });
    if (start + CHUNK_WINDOW_LINES >= lines.length) {
      break;
    }
  }

  return chunks;
}

function searchContainsWithoutIndex(
  workspaceRoot: string,
  query: string,
  limit: number
): {
  results: SearchHit[];
  files: number;
  chunks: number;
} {
  const files = listMemoryFiles(workspaceRoot);
  const needle = query.toLowerCase();
  const allChunks: ChunkRecord[] = [];
  for (const file of files) {
    allChunks.push(...buildChunks(file.relPath, file.text));
  }
  const matched = allChunks
    .filter((chunk) => chunk.text.toLowerCase().includes(needle))
    .map((chunk) => ({
      id: chunk.id,
      path: chunk.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      snippet: clipSnippet(chunk.text),
      score: roundScore(0.35 + Math.min(0.55, countOccurrences(chunk.text.toLowerCase(), needle) * 0.1)),
      source: "memory" as const
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    results: matched,
    files: files.length,
    chunks: allChunks.length
  };
}

function resetCorruptedIndex(dbPath: string): void {
  try {
    rmSync(dbPath, { force: true });
  } catch {
    // ignore reset failures
  }
}

function resolveEmbeddingProvider(): ProviderConfig | undefined {
  const env = process.env ?? {};

  const openAiKey = firstNonEmptyString(
    env.OPENFOAL_MEMORY_OPENAI_API_KEY,
    env.OPENFOAL_MEMORY_API_KEY,
    env.OPENAI_API_KEY
  );
  if (openAiKey) {
    return {
      provider: "openai",
      model:
        firstNonEmptyString(env.OPENFOAL_MEMORY_OPENAI_MODEL, env.OPENFOAL_MEMORY_MODEL, env.OPENAI_EMBEDDING_MODEL) ??
        "text-embedding-3-small"
    };
  }

  const geminiKey = firstNonEmptyString(
    env.OPENFOAL_MEMORY_GEMINI_API_KEY,
    env.GEMINI_API_KEY,
    env.GOOGLE_API_KEY
  );
  if (geminiKey) {
    return {
      provider: "gemini",
      model:
        firstNonEmptyString(env.OPENFOAL_MEMORY_GEMINI_MODEL, env.OPENFOAL_MEMORY_MODEL, env.GEMINI_EMBEDDING_MODEL) ??
        "gemini-embedding-001"
    };
  }

  const voyageKey = firstNonEmptyString(
    env.OPENFOAL_MEMORY_VOYAGE_API_KEY,
    env.VOYAGE_API_KEY
  );
  if (voyageKey) {
    return {
      provider: "voyage",
      model:
        firstNonEmptyString(env.OPENFOAL_MEMORY_VOYAGE_MODEL, env.OPENFOAL_MEMORY_MODEL, env.VOYAGE_EMBEDDING_MODEL) ??
        "voyage-3-large"
    };
  }

  return undefined;
}

function embedText(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMS).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return vector;
  }

  for (const token of tokens) {
    const h = hashToken(token);
    const index = h % EMBEDDING_DIMS;
    const sign = (h & 1) === 0 ? 1 : -1;
    const magnitude = 1 + ((h >>> 8) % 1000) / 1000;
    vector[index] += sign * magnitude;
  }
  return normalizeVector(vector);
}

function hashToken(token: string): number {
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function normalizeVector(vec: number[]): number[] {
  const sumSquares = vec.reduce((sum, value) => sum + value * value, 0);
  if (sumSquares <= 0) {
    return vec;
  }
  const norm = Math.sqrt(sumSquares);
  return vec.map((value) => Number((value / norm).toFixed(8)));
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na <= 0 || nb <= 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function parseVector(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((value) => typeof value === "number" && Number.isFinite(value))
      .map((value) => Number(value));
  } catch {
    return [];
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9_\u4e00-\u9fff-]+/g, ""))
    .filter((token) => token.length > 0);
}

function isMemorySearchEnabled(): boolean {
  const raw = firstNonEmptyString(process.env?.OPENFOAL_MEMORY_SEARCH_ENABLED);
  if (!raw) {
    return true;
  }
  const normalized = raw.toLowerCase();
  return !(normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no");
}

function execSql(dbPath: string, sql: string): void {
  const result = spawnSync("sqlite3", [dbPath, sql], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`sqlite exec failed: ${detail}`);
  }
}

function queryJson<T>(dbPath: string, sql: string): T[] {
  const result = spawnSync("sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`sqlite query failed: ${detail}`);
  }
  const text = (result.stdout ?? "").trim();
  if (!text) {
    return [];
  }
  return JSON.parse(text) as T[];
}

function success(payload: SearchResponse): ToolResultLike {
  return {
    ok: true,
    output: JSON.stringify(payload)
  };
}

function fail(message: string): ToolResultLike {
  return {
    ok: false,
    error: {
      code: "TOOL_EXEC_FAILED",
      message
    }
  };
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  return Math.max(min, Math.min(max, rounded));
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function roundScore(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return Number(clamped.toFixed(6));
}

function toPositiveLine(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : 1;
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return text.split(/\r?\n/).length;
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let cursor = 0;
  while (true) {
    const index = text.indexOf(needle, cursor);
    if (index < 0) {
      break;
    }
    count += 1;
    cursor = index + needle.length;
  }
  return count;
}

function clipSnippet(text: string): string {
  if (text.length <= SNIPPET_MAX_CHARS) {
    return text;
  }
  return `${text.slice(0, SNIPPET_MAX_CHARS - 3)}...`;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function logDebug(message: string): void {
  try {
    if (process?.env?.OPENFOAL_MEMORY_SEARCH_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.warn(`[memory-search] ${message}`);
    }
  } catch {
    // ignore logging failures
  }
}
