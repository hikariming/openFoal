import { Pool } from "pg";

declare const process: any;

const pools = new Map<string, Pool>();
const schemaInit = new Map<string, Promise<void>>();

export function resolvePostgresUrl(explicit?: string): string {
  const fromEnv = typeof process?.env?.OPENFOAL_POSTGRES_URL === "string" ? process.env.OPENFOAL_POSTGRES_URL.trim() : "";
  const picked = explicit && explicit.trim().length > 0 ? explicit.trim() : fromEnv;
  if (!picked) {
    return "postgres://openfoal:openfoal@127.0.0.1:5432/openfoal";
  }
  return picked;
}

export function getPostgresPool(url: string): Pool {
  const cached = pools.get(url);
  if (cached) {
    return cached;
  }
  const pool = new Pool({
    connectionString: url,
    max: parsePositiveInt(process?.env?.OPENFOAL_POSTGRES_POOL_MAX, 20),
    idleTimeoutMillis: parsePositiveInt(process?.env?.OPENFOAL_POSTGRES_POOL_IDLE_MS, 30000),
    connectionTimeoutMillis: parsePositiveInt(process?.env?.OPENFOAL_POSTGRES_CONNECT_TIMEOUT_MS, 5000)
  });
  pools.set(url, pool);
  return pool;
}

export async function ensurePostgresSchemaOnce(
  url: string,
  schemaKey: string,
  run: (pool: Pool) => Promise<void>
): Promise<void> {
  const key = `${schemaKey}:${url}`;
  const existing = schemaInit.get(key);
  if (existing) {
    await existing;
    return;
  }
  const pool = getPostgresPool(url);
  const promise = (async () => {
    await run(pool);
  })();
  schemaInit.set(key, promise);
  try {
    await promise;
  } catch (error) {
    schemaInit.delete(key);
    throw error;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sanitizeScopeId(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

export function parsePositiveInt(value: unknown, fallback: number): number {
  const asNumber = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(asNumber)) {
    return fallback;
  }
  const rounded = Math.floor(asNumber);
  return rounded > 0 ? rounded : fallback;
}

export function parseSafeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function parseSafeInt(value: unknown, fallback = 0): number {
  const parsed = parseSafeNumber(value, fallback);
  return Math.floor(parsed);
}

export function clampInt(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function round6(value: number): number {
  return Number(value.toFixed(6));
}

export async function closeAllPostgresPools(): Promise<void> {
  const values = [...pools.values()];
  pools.clear();
  await Promise.all(values.map((pool) => pool.end()));
}
