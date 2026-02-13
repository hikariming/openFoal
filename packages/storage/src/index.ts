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

function defaultSession(): SessionRecord {
  return {
    id: "s_default",
    sessionKey: "workspace:w_default/agent:a_default/main",
    runtimeMode: "local",
    syncState: "local_only",
    updatedAt: nowIso()
  };
}

function nowIso(): string {
  return new Date().toISOString();
}
