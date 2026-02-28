export type SkillSyncScope = "tenant" | "workspace" | "user";
export type SkillSyncMode = "online" | "bundle_only";
export type SkillSyncLicense = "allow" | "review" | "deny";

export interface SkillSyncConfig {
  autoSyncEnabled: boolean;
  syncTime: string;
  timezone: string;
  syncMode: SkillSyncMode;
  sourceFilters: string[];
  licenseFilters: SkillSyncLicense[];
  tagFilters: string[];
  manualOnly: boolean;
}

export interface SkillSyncConfigPatch {
  autoSyncEnabled?: boolean;
  syncTime?: string;
  timezone?: string;
  syncMode?: SkillSyncMode;
  sourceFilters?: string[];
  licenseFilters?: SkillSyncLicense[];
  tagFilters?: string[];
  manualOnly?: boolean;
}

export interface SkillSyncConfigLayers {
  tenant?: SkillSyncConfigPatch;
  workspace?: SkillSyncConfigPatch;
  user?: SkillSyncConfigPatch;
}

export const SKILL_SYNC_DEFAULT_SYNC_TIME = "03:00";
export const SKILL_SYNC_DEFAULT_SOURCES = ["anthropics/skills", "affaan-m/everything-claude-code"];
export const SKILL_SYNC_DEFAULT_LICENSES: SkillSyncLicense[] = ["allow", "review"];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isSkillSyncScope(value: unknown): value is SkillSyncScope {
  return value === "tenant" || value === "workspace" || value === "user";
}

export function isSkillSyncMode(value: unknown): value is SkillSyncMode {
  return value === "online" || value === "bundle_only";
}

export function isSkillSyncLicense(value: unknown): value is SkillSyncLicense {
  return value === "allow" || value === "review" || value === "deny";
}

export function defaultSkillSyncConfig(input: {
  timezone?: string;
  registeredSources?: string[];
} = {}): SkillSyncConfig {
  const timezone = normalizeTimezone(input.timezone, defaultTimezone());
  const registeredSources = normalizeUniqueStrings(input.registeredSources);
  const sourceFilters = registeredSources.length > 0 ? registeredSources : [...SKILL_SYNC_DEFAULT_SOURCES];

  return {
    autoSyncEnabled: true,
    syncTime: SKILL_SYNC_DEFAULT_SYNC_TIME,
    timezone,
    syncMode: "online",
    sourceFilters,
    licenseFilters: [...SKILL_SYNC_DEFAULT_LICENSES],
    tagFilters: [],
    manualOnly: false
  };
}

export function resolveEffectiveSkillSyncConfig(input: {
  defaults: SkillSyncConfig;
  layers?: SkillSyncConfigLayers;
}): SkillSyncConfig {
  const tenant = input.layers?.tenant ?? {};
  const workspace = input.layers?.workspace ?? {};
  const user = input.layers?.user ?? {};
  return normalizeSkillSyncConfig({
    ...input.defaults,
    ...tenant,
    ...workspace,
    ...user
  });
}

export function normalizeSkillSyncConfig(config: SkillSyncConfig): SkillSyncConfig {
  return {
    autoSyncEnabled: config.autoSyncEnabled !== false,
    syncTime: normalizeSyncTime(config.syncTime, SKILL_SYNC_DEFAULT_SYNC_TIME),
    timezone: normalizeTimezone(config.timezone, defaultTimezone()),
    syncMode: isSkillSyncMode(config.syncMode) ? config.syncMode : "online",
    sourceFilters: normalizeUniqueStrings(config.sourceFilters),
    licenseFilters: normalizeLicenseFilters(config.licenseFilters),
    tagFilters: normalizeUniqueStrings(config.tagFilters),
    manualOnly: config.manualOnly === true
  };
}

export function normalizeSkillSyncPatch(raw: Record<string, unknown>): SkillSyncConfigPatch {
  const patch: SkillSyncConfigPatch = {};
  if (typeof raw.autoSyncEnabled === "boolean") {
    patch.autoSyncEnabled = raw.autoSyncEnabled;
  }
  if (typeof raw.syncTime === "string") {
    patch.syncTime = normalizeSyncTime(raw.syncTime, SKILL_SYNC_DEFAULT_SYNC_TIME);
  }
  if (typeof raw.timezone === "string") {
    patch.timezone = normalizeTimezone(raw.timezone, defaultTimezone());
  }
  if (isSkillSyncMode(raw.syncMode)) {
    patch.syncMode = raw.syncMode;
  }
  if (Array.isArray(raw.sourceFilters)) {
    patch.sourceFilters = normalizeUniqueStrings(raw.sourceFilters);
  }
  if (Array.isArray(raw.licenseFilters)) {
    patch.licenseFilters = normalizeLicenseFilters(raw.licenseFilters);
  }
  if (Array.isArray(raw.tagFilters)) {
    patch.tagFilters = normalizeUniqueStrings(raw.tagFilters);
  }
  if (typeof raw.manualOnly === "boolean") {
    patch.manualOnly = raw.manualOnly;
  }
  return patch;
}

export function normalizeSyncTime(value: string | undefined, fallback = SKILL_SYNC_DEFAULT_SYNC_TIME): string {
  const trimmed = (value ?? "").trim();
  return TIME_RE.test(trimmed) ? trimmed : fallback;
}

export function normalizeTimezone(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return fallback;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return trimmed;
  } catch {
    return fallback;
  }
}

export function normalizeUniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    seen.add(trimmed);
  }
  return [...seen.values()];
}

export function normalizeLicenseFilters(value: unknown): SkillSyncLicense[] {
  if (!Array.isArray(value)) {
    return [...SKILL_SYNC_DEFAULT_LICENSES];
  }
  const seen = new Set<SkillSyncLicense>();
  for (const entry of value) {
    if (isSkillSyncLicense(entry)) {
      seen.add(entry);
    }
  }
  const result = [...seen.values()];
  return result.length > 0 ? result : [...SKILL_SYNC_DEFAULT_LICENSES];
}

export function validateSecurityBoundary(input: {
  parent: SkillSyncConfig;
  childPatch: SkillSyncConfigPatch;
}): { ok: true } | { ok: false; message: string } {
  const sourceCheck = validateSubsetBoundary("sourceFilters", input.parent.sourceFilters, input.childPatch.sourceFilters);
  if (!sourceCheck.ok) {
    return sourceCheck;
  }
  const licenseCheck = validateSubsetBoundary("licenseFilters", input.parent.licenseFilters, input.childPatch.licenseFilters);
  if (!licenseCheck.ok) {
    return licenseCheck;
  }
  const tagCheck = validateSubsetBoundary("tagFilters", input.parent.tagFilters, input.childPatch.tagFilters);
  if (!tagCheck.ok) {
    return tagCheck;
  }
  return { ok: true };
}

export function computeNextDailyRunAt(input: {
  now?: Date;
  syncTime: string;
  timezone: string;
}): string {
  const now = input.now ?? new Date();
  const timezone = normalizeTimezone(input.timezone, defaultTimezone());
  const syncTime = normalizeSyncTime(input.syncTime, SKILL_SYNC_DEFAULT_SYNC_TIME);
  const [hourPart, minutePart] = syncTime.split(":");
  const hour = Number(hourPart);
  const minute = Number(minutePart);

  const zonedNow = getZonedParts(now, timezone);
  let candidate = zonedDateToUtc(
    {
      year: zonedNow.year,
      month: zonedNow.month,
      day: zonedNow.day,
      hour,
      minute,
      second: 0
    },
    timezone
  );

  if (candidate.getTime() <= now.getTime()) {
    const nextDay = addDays(zonedNow.year, zonedNow.month, zonedNow.day, 1);
    candidate = zonedDateToUtc(
      {
        year: nextDay.year,
        month: nextDay.month,
        day: nextDay.day,
        hour,
        minute,
        second: 0
      },
      timezone
    );
  }

  return candidate.toISOString();
}

export function defaultTimezone(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolved && resolved.trim().length > 0 ? resolved : "UTC";
  } catch {
    return "UTC";
  }
}

function validateSubsetBoundary(
  field: "sourceFilters" | "licenseFilters" | "tagFilters",
  parent: readonly string[],
  child: readonly string[] | undefined
): { ok: true } | { ok: false; message: string } {
  if (!child) {
    return { ok: true };
  }
  if (parent.length === 0) {
    return { ok: true };
  }
  if (child.length === 0) {
    return {
      ok: false,
      message: `${field} 不能为空；下层不能清空上层限制`
    };
  }
  const parentSet = new Set(parent);
  const escaped = child.filter((item) => !parentSet.has(item));
  if (escaped.length > 0) {
    return {
      ok: false,
      message: `${field} 超出上层安全边界: ${escaped.join(", ")}`
    };
  }
  return { ok: true };
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = getDateTimeFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const map = new Map<string, string>();
  for (const part of parts) {
    if (part.type !== "literal") {
      map.set(part.type, part.value);
    }
  }
  return {
    year: Number(map.get("year") ?? 0),
    month: Number(map.get("month") ?? 1),
    day: Number(map.get("day") ?? 1),
    hour: Number(map.get("hour") ?? 0),
    minute: Number(map.get("minute") ?? 0),
    second: Number(map.get("second") ?? 0)
  };
}

function zonedDateToUtc(parts: ZonedParts, timeZone: string): Date {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let offset = getTimezoneOffsetMinutes(new Date(utcGuess), timeZone);
  let finalUtc = utcGuess - offset * 60_000;
  const secondOffset = getTimezoneOffsetMinutes(new Date(finalUtc), timeZone);
  if (secondOffset !== offset) {
    offset = secondOffset;
    finalUtc = utcGuess - offset * 60_000;
  }
  return new Date(finalUtc);
}

function getTimezoneOffsetMinutes(date: Date, timeZone: string): number {
  const zoned = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate()
  };
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getDateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}
