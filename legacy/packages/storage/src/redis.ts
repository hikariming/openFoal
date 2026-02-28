import { createClient } from "redis";
import type { IdempotencyRecord, IdempotencyRepository, IdempotencyResult } from "./index.js";

declare const process: any;

const clients = new Map<string, any>();
const connecting = new Map<string, Promise<any>>();

export interface RedisStoreOptions {
  redisUrl?: string;
  keyPrefix?: string;
}

export interface ConnectionBindingRecord {
  connectionId: string;
  subject: string;
  userId: string;
  tenantId: string;
  workspaceIds: string[];
  roles: string[];
  boundAt: string;
}

export class RedisIdempotencyRepository implements IdempotencyRepository {
  private readonly redisUrl: string;
  private readonly keyPrefix: string;

  constructor(options: RedisStoreOptions = {}) {
    this.redisUrl = resolveRedisUrl(options.redisUrl);
    this.keyPrefix = options.keyPrefix ?? "openfoal:idem";
  }

  async get(cacheKey: string): Promise<IdempotencyRecord | undefined> {
    const client = await getRedisClient(this.redisUrl);
    const value = await client.get(this.wrap(cacheKey));
    if (!value) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(value) as {
        fingerprint?: unknown;
        result?: unknown;
        createdAt?: unknown;
      };
      return {
        fingerprint: typeof parsed.fingerprint === "string" ? parsed.fingerprint : "",
        result: normalizeIdempotencyResult(parsed.result),
        createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString()
      };
    } catch {
      return undefined;
    }
  }

  async set(
    cacheKey: string,
    value: {
      fingerprint: string;
      result: IdempotencyResult;
      createdAt?: string;
    }
  ): Promise<void> {
    const client = await getRedisClient(this.redisUrl);
    await client.set(
      this.wrap(cacheKey),
      JSON.stringify({
        fingerprint: value.fingerprint,
        result: value.result,
        createdAt: value.createdAt ?? new Date().toISOString()
      }),
      {
        EX: 24 * 60 * 60
      }
    );
  }

  private wrap(cacheKey: string): string {
    return `${this.keyPrefix}:${cacheKey}`;
  }
}

export class RedisConnectionBindingStore {
  private readonly redisUrl: string;
  private readonly keyPrefix: string;

  constructor(options: RedisStoreOptions = {}) {
    this.redisUrl = resolveRedisUrl(options.redisUrl);
    this.keyPrefix = options.keyPrefix ?? "openfoal:conn";
  }

  async bind(record: ConnectionBindingRecord, ttlSeconds = 2 * 60 * 60): Promise<void> {
    const client = await getRedisClient(this.redisUrl);
    await client.set(this.wrap(record.connectionId), JSON.stringify(record), {
      EX: Math.max(60, Math.floor(ttlSeconds))
    });
  }

  async get(connectionId: string): Promise<ConnectionBindingRecord | undefined> {
    const client = await getRedisClient(this.redisUrl);
    const value = await client.get(this.wrap(connectionId));
    if (!value) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (typeof parsed.connectionId !== "string" || typeof parsed.subject !== "string" || typeof parsed.tenantId !== "string") {
        return undefined;
      }
      return {
        connectionId: parsed.connectionId,
        subject: parsed.subject,
        userId: typeof parsed.userId === "string" ? parsed.userId : parsed.subject,
        tenantId: parsed.tenantId,
        workspaceIds: Array.isArray(parsed.workspaceIds) ? parsed.workspaceIds.map((item) => String(item)) : [],
        roles: Array.isArray(parsed.roles) ? parsed.roles.map((item) => String(item)) : [],
        boundAt: typeof parsed.boundAt === "string" ? parsed.boundAt : new Date().toISOString()
      };
    } catch {
      return undefined;
    }
  }

  async remove(connectionId: string): Promise<void> {
    const client = await getRedisClient(this.redisUrl);
    await client.del(this.wrap(connectionId));
  }

  private wrap(connectionId: string): string {
    return `${this.keyPrefix}:${connectionId}`;
  }
}

export interface LeaseRecord {
  tenantId: string;
  workspaceId: string;
  userId: string;
  sessionId: string;
  containerId: string;
  workspaceRoot: string;
  createdAt: string;
  lastSeenAt: string;
}

export class RedisLeaseIndex {
  private readonly redisUrl: string;
  private readonly keyPrefix: string;

  constructor(options: RedisStoreOptions = {}) {
    this.redisUrl = resolveRedisUrl(options.redisUrl);
    this.keyPrefix = options.keyPrefix ?? "openfoal:lease";
  }

  async touch(record: LeaseRecord, ttlSeconds = 15 * 60): Promise<void> {
    const client = await getRedisClient(this.redisUrl);
    await client.set(this.key(record), JSON.stringify(record), {
      EX: Math.max(30, Math.floor(ttlSeconds))
    });
  }

  async get(input: { tenantId: string; workspaceId: string; userId: string; sessionId: string }): Promise<LeaseRecord | undefined> {
    const client = await getRedisClient(this.redisUrl);
    const value = await client.get(this.key(input));
    if (!value) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (
        typeof parsed.tenantId !== "string" ||
        typeof parsed.workspaceId !== "string" ||
        typeof parsed.userId !== "string" ||
        typeof parsed.sessionId !== "string" ||
        typeof parsed.containerId !== "string" ||
        typeof parsed.workspaceRoot !== "string"
      ) {
        return undefined;
      }
      return {
        tenantId: parsed.tenantId,
        workspaceId: parsed.workspaceId,
        userId: parsed.userId,
        sessionId: parsed.sessionId,
        containerId: parsed.containerId,
        workspaceRoot: parsed.workspaceRoot,
        createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
        lastSeenAt: typeof parsed.lastSeenAt === "string" ? parsed.lastSeenAt : new Date().toISOString()
      };
    } catch {
      return undefined;
    }
  }

  async remove(input: { tenantId: string; workspaceId: string; userId: string; sessionId: string }): Promise<void> {
    const client = await getRedisClient(this.redisUrl);
    await client.del(this.key(input));
  }

  private key(input: { tenantId: string; workspaceId: string; userId: string; sessionId: string }): string {
    return `${this.keyPrefix}:${sanitize(input.tenantId)}:${sanitize(input.workspaceId)}:${sanitize(input.userId)}:${sanitize(input.sessionId)}`;
  }
}

function resolveRedisUrl(explicit?: string): string {
  const fromEnv = typeof process?.env?.OPENFOAL_REDIS_URL === "string" ? process.env.OPENFOAL_REDIS_URL.trim() : "";
  const selected = explicit && explicit.trim().length > 0 ? explicit.trim() : fromEnv;
  return selected || "redis://127.0.0.1:6379";
}

async function getRedisClient(url: string): Promise<any> {
  const cached = clients.get(url);
  if (cached) {
    if (!cached.isOpen) {
      const inFlight = connecting.get(url);
      if (inFlight) {
        await inFlight;
      } else {
        const next = cached.connect();
        connecting.set(url, next);
        try {
          await next;
        } finally {
          connecting.delete(url);
        }
      }
    }
    return cached;
  }

  const client = createClient({
    url
  });
  client.on("error", () => {
    // errors are surfaced in call sites; keep process alive.
  });
  clients.set(url, client);
  const connectPromise = client.connect();
  connecting.set(url, connectPromise);
  try {
    await connectPromise;
  } finally {
    connecting.delete(url);
  }
  return client;
}

function normalizeIdempotencyResult(value: unknown): IdempotencyResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      response: null,
      events: []
    };
  }
  const record = value as Record<string, unknown>;
  return {
    response: record.response,
    events: Array.isArray(record.events) ? record.events : []
  };
}

function sanitize(value: string): string {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9._-]/g, "_");
}

export async function closeAllRedisClients(): Promise<void> {
  const all = [...clients.values()];
  clients.clear();
  await Promise.all(all.map((client) => client.quit()));
}
