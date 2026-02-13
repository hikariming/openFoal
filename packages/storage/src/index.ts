// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { spawnSync } from "node:child_process";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { mkdirSync } from "node:fs";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { dirname, resolve } from "node:path";

declare const process: any;

export type RuntimeMode = "local" | "cloud";
export type SyncState = "local_only" | "syncing" | "synced" | "conflict";

export interface SessionRecord {
  id: string;
  sessionKey: string;
  runtimeMode: RuntimeMode;
  syncState: SyncState;
  updatedAt: string;
}

export interface SessionRepository {
  list(): Promise<SessionRecord[]>;
  get(sessionId: string): Promise<SessionRecord | undefined>;
  upsert(session: SessionRecord): Promise<void>;
  setRuntimeMode(sessionId: string, runtimeMode: RuntimeMode): Promise<SessionRecord | undefined>;
}

export interface TranscriptRecord {
  id: number;
  sessionId: string;
  runId?: string;
  event: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface TranscriptRepository {
  append(entry: {
    sessionId: string;
    runId?: string;
    event: string;
    payload: Record<string, unknown>;
    createdAt?: string;
  }): Promise<void>;
  list(sessionId: string, limit?: number): Promise<TranscriptRecord[]>;
}

export interface IdempotencyResult {
  response: unknown;
  events: unknown[];
}

export interface IdempotencyRecord {
  fingerprint: string;
  result: IdempotencyResult;
  createdAt: string;
}

export interface IdempotencyRepository {
  get(cacheKey: string): Promise<IdempotencyRecord | undefined>;
  set(
    cacheKey: string,
    value: {
      fingerprint: string;
      result: IdempotencyResult;
      createdAt?: string;
    }
  ): Promise<void>;
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(initialSessions?: SessionRecord[]) {
    const seed = initialSessions ?? [defaultSession()];
    for (const session of seed) {
      this.sessions.set(session.id, session);
    }
  }

  async list(): Promise<SessionRecord[]> {
    return Array.from(this.sessions.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    return this.sessions.get(sessionId);
  }

  async upsert(session: SessionRecord): Promise<void> {
    this.sessions.set(session.id, { ...session, updatedAt: nowIso() });
  }

  async setRuntimeMode(sessionId: string, runtimeMode: RuntimeMode): Promise<SessionRecord | undefined> {
    const current = this.sessions.get(sessionId);
    if (!current) {
      return undefined;
    }

    const next: SessionRecord = {
      ...current,
      runtimeMode,
      updatedAt: nowIso()
    };
    this.sessions.set(sessionId, next);
    return next;
  }
}

export class InMemoryTranscriptRepository implements TranscriptRepository {
  private readonly items: TranscriptRecord[] = [];
  private nextId = 1;

  async append(entry: {
    sessionId: string;
    runId?: string;
    event: string;
    payload: Record<string, unknown>;
    createdAt?: string;
  }): Promise<void> {
    this.items.push({
      id: this.nextId++,
      sessionId: entry.sessionId,
      runId: entry.runId,
      event: entry.event,
      payload: entry.payload,
      createdAt: entry.createdAt ?? nowIso()
    });
  }

  async list(sessionId: string, limit = 50): Promise<TranscriptRecord[]> {
    const filtered = this.items.filter((item) => item.sessionId === sessionId);
    return filtered.slice(Math.max(0, filtered.length - limit));
  }
}

export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly store = new Map<string, IdempotencyRecord>();

  async get(cacheKey: string): Promise<IdempotencyRecord | undefined> {
    return this.store.get(cacheKey);
  }

  async set(
    cacheKey: string,
    value: {
      fingerprint: string;
      result: IdempotencyResult;
      createdAt?: string;
    }
  ): Promise<void> {
    this.store.set(cacheKey, {
      fingerprint: value.fingerprint,
      result: value.result,
      createdAt: value.createdAt ?? nowIso()
    });
  }
}

export class SqliteSessionRepository implements SessionRepository {
  private readonly dbPath: string;

  constructor(dbPath = defaultSqlitePath()) {
    this.dbPath = normalizeDbPath(dbPath);
  }

  async list(): Promise<SessionRecord[]> {
    ensureSchema(this.dbPath);
    return queryJson<SessionRecord>(
      this.dbPath,
      `
        SELECT
          id AS id,
          session_key AS sessionKey,
          runtime_mode AS runtimeMode,
          sync_state AS syncState,
          updated_at AS updatedAt
        FROM sessions
        ORDER BY updated_at DESC;
      `
    );
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    ensureSchema(this.dbPath);
    const rows = queryJson<SessionRecord>(
      this.dbPath,
      `
        SELECT
          id AS id,
          session_key AS sessionKey,
          runtime_mode AS runtimeMode,
          sync_state AS syncState,
          updated_at AS updatedAt
        FROM sessions
        WHERE id = ${sqlString(sessionId)}
        LIMIT 1;
      `
    );
    return rows[0];
  }

  async upsert(session: SessionRecord): Promise<void> {
    ensureSchema(this.dbPath);
    const updatedAt = nowIso();
    execSql(
      this.dbPath,
      `
        INSERT INTO sessions (id, session_key, runtime_mode, sync_state, updated_at)
        VALUES (
          ${sqlString(session.id)},
          ${sqlString(session.sessionKey)},
          ${sqlString(session.runtimeMode)},
          ${sqlString(session.syncState)},
          ${sqlString(updatedAt)}
        )
        ON CONFLICT(id) DO UPDATE SET
          session_key = excluded.session_key,
          runtime_mode = excluded.runtime_mode,
          sync_state = excluded.sync_state,
          updated_at = excluded.updated_at;
      `
    );
  }

  async setRuntimeMode(sessionId: string, runtimeMode: RuntimeMode): Promise<SessionRecord | undefined> {
    ensureSchema(this.dbPath);
    const existing = await this.get(sessionId);
    if (!existing) {
      return undefined;
    }

    const updatedAt = nowIso();
    execSql(
      this.dbPath,
      `
        UPDATE sessions
        SET runtime_mode = ${sqlString(runtimeMode)}, updated_at = ${sqlString(updatedAt)}
        WHERE id = ${sqlString(sessionId)};
      `
    );

    return await this.get(sessionId);
  }
}

export class SqliteTranscriptRepository implements TranscriptRepository {
  private readonly dbPath: string;

  constructor(dbPath = defaultSqlitePath()) {
    this.dbPath = normalizeDbPath(dbPath);
  }

  async append(entry: {
    sessionId: string;
    runId?: string;
    event: string;
    payload: Record<string, unknown>;
    createdAt?: string;
  }): Promise<void> {
    ensureSchema(this.dbPath);
    execSql(
      this.dbPath,
      `
        INSERT INTO transcript (session_id, run_id, event, payload_json, created_at)
        VALUES (
          ${sqlString(entry.sessionId)},
          ${sqlMaybeString(entry.runId)},
          ${sqlString(entry.event)},
          ${sqlString(JSON.stringify(entry.payload))},
          ${sqlString(entry.createdAt ?? nowIso())}
        );
      `
    );
  }

  async list(sessionId: string, limit = 50): Promise<TranscriptRecord[]> {
    ensureSchema(this.dbPath);
    const safeLimit = Math.max(1, Math.floor(limit));
    const rows = queryJson<{
      id: number;
      sessionId: string;
      runId: string | null;
      event: string;
      payloadJson: string;
      createdAt: string;
    }>(
      this.dbPath,
      `
        SELECT
          id AS id,
          session_id AS sessionId,
          run_id AS runId,
          event AS event,
          payload_json AS payloadJson,
          created_at AS createdAt
        FROM (
          SELECT
            id,
            session_id,
            run_id,
            event,
            payload_json,
            created_at
          FROM transcript
          WHERE session_id = ${sqlString(sessionId)}
          ORDER BY id DESC
          LIMIT ${safeLimit}
        )
        ORDER BY id ASC;
      `
    );

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      runId: row.runId ?? undefined,
      event: row.event,
      payload: parseJsonObject(row.payloadJson),
      createdAt: row.createdAt
    }));
  }
}

export class SqliteIdempotencyRepository implements IdempotencyRepository {
  private readonly dbPath: string;

  constructor(dbPath = defaultSqlitePath()) {
    this.dbPath = normalizeDbPath(dbPath);
  }

  async get(cacheKey: string): Promise<IdempotencyRecord | undefined> {
    ensureSchema(this.dbPath);
    const rows = queryJson<{
      fingerprint: string;
      resultJson: string;
      createdAt: string;
    }>(
      this.dbPath,
      `
        SELECT
          fingerprint AS fingerprint,
          result_json AS resultJson,
          created_at AS createdAt
        FROM idempotency
        WHERE cache_key = ${sqlString(cacheKey)}
        LIMIT 1;
      `
    );
    if (rows.length === 0) {
      return undefined;
    }

    const row = rows[0];
    return {
      fingerprint: row.fingerprint,
      result: parseIdempotencyResult(row.resultJson),
      createdAt: row.createdAt
    };
  }

  async set(
    cacheKey: string,
    value: {
      fingerprint: string;
      result: IdempotencyResult;
      createdAt?: string;
    }
  ): Promise<void> {
    ensureSchema(this.dbPath);
    execSql(
      this.dbPath,
      `
        INSERT INTO idempotency (cache_key, fingerprint, result_json, created_at)
        VALUES (
          ${sqlString(cacheKey)},
          ${sqlString(value.fingerprint)},
          ${sqlString(JSON.stringify(value.result))},
          ${sqlString(value.createdAt ?? nowIso())}
        )
        ON CONFLICT(cache_key) DO UPDATE SET
          fingerprint = excluded.fingerprint,
          result_json = excluded.result_json,
          created_at = excluded.created_at;
      `
    );
  }
}

function defaultSession(): SessionRecord {
  return {
    id: "s_default",
    sessionKey: "workspace:w_default/agent:a_default/main",
    runtimeMode: "local",
    syncState: "local_only",
    updatedAt: nowIso()
  };
}

function defaultSqlitePath(): string {
  const fromEnv = process.env.OPENFOAL_SQLITE_PATH;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return normalizeDbPath(fromEnv.trim());
  }
  return normalizeDbPath(resolve(process.cwd(), ".openfoal", "gateway.sqlite"));
}

const initializedDbPaths = new Set<string>();

function ensureSchema(dbPath: string): void {
  if (initializedDbPaths.has(dbPath)) {
    return;
  }

  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  execSql(
    dbPath,
    `
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        session_key TEXT NOT NULL,
        runtime_mode TEXT NOT NULL,
        sync_state TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
      ON sessions(updated_at DESC);

      CREATE TABLE IF NOT EXISTS transcript (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        run_id TEXT,
        event TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_transcript_session_id
      ON transcript(session_id, id DESC);

      CREATE TABLE IF NOT EXISTS idempotency (
        cache_key TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO sessions (id, session_key, runtime_mode, sync_state, updated_at)
      VALUES (
        ${sqlString("s_default")},
        ${sqlString("workspace:w_default/agent:a_default/main")},
        ${sqlString("local")},
        ${sqlString("local_only")},
        ${sqlString(nowIso())}
      );
    `
  );

  initializedDbPaths.add(dbPath);
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
  if (text.length === 0) {
    return [];
  }
  return JSON.parse(text) as T[];
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlMaybeString(value: string | undefined): string {
  if (!value || value.length === 0) {
    return "NULL";
  }
  return sqlString(value);
}

function normalizeDbPath(dbPath: string): string {
  if (dbPath === ":memory:") {
    return dbPath;
  }
  return resolve(dbPath);
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function parseIdempotencyResult(value: string): IdempotencyResult {
  try {
    const parsed = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "response" in parsed &&
      "events" in parsed &&
      Array.isArray((parsed as Record<string, unknown>).events)
    ) {
      return parsed as IdempotencyResult;
    }
  } catch {
    // ignore parse error
  }
  return {
    response: null,
    events: []
  };
}

function nowIso(): string {
  return new Date().toISOString();
}
