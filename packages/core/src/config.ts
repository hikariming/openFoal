// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { existsSync, readFileSync } from "node:fs";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { isAbsolute, join, resolve } from "node:path";

declare const process: any;

export type EnvMap = Record<string, string | undefined>;

export type OpenFoalModelApi = "openai-completions" | "openai-responses" | "anthropic-messages";

export interface OpenFoalLlmProviderConfig {
  api?: OpenFoalModelApi;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
}

export interface OpenFoalCoreConfig {
  version?: number;
  llm?: {
    defaultProvider?: string;
    defaultModel?: string;
    providers?: Record<string, OpenFoalLlmProviderConfig>;
  };
}

export interface OpenFoalCoreConfigLoadOptions {
  configPath?: string;
  policyPath?: string;
  env?: EnvMap;
}

const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export class MissingConfigEnvVarError extends Error {
  readonly varName: string;
  readonly configPath: string;

  constructor(varName: string, configPath: string) {
    super(`Missing env var "${varName}" referenced at config path: ${configPath}`);
    this.name = "MissingConfigEnvVarError";
    this.varName = varName;
    this.configPath = configPath;
  }
}

export function loadOpenFoalCoreConfig(options: OpenFoalCoreConfigLoadOptions = {}): OpenFoalCoreConfig {
  const env = options.env ?? (process.env as EnvMap);
  const configPath = resolveOpenFoalConfigPath(options.configPath, env);
  const policyPath = resolveOpenFoalPolicyPath(options.policyPath, env);

  const configJson = readJsonFile(configPath);
  const policyJson = policyPath ? readJsonFile(policyPath) : {};
  const merged = deepMerge(configJson, policyJson);
  const substituted = resolveConfigEnvVars(merged, env);
  return asCoreConfig(substituted);
}

function resolveOpenFoalConfigPath(configPath: string | undefined, env: EnvMap): string {
  const explicit = firstNonEmpty(configPath, env.OPENFOAL_CONFIG_PATH);
  if (explicit) {
    return normalizePath(explicit);
  }

  const home = firstNonEmpty(env.HOME, env.USERPROFILE, process.cwd()) ?? process.cwd();
  return normalizePath(join(home, ".openfoal", "openfoal.json"));
}

function resolveOpenFoalPolicyPath(policyPath: string | undefined, env: EnvMap): string | undefined {
  const explicit = firstNonEmpty(policyPath, env.OPENFOAL_POLICY_PATH);
  if (!explicit) {
    return undefined;
  }
  return normalizePath(explicit);
}

function normalizePath(filePath: string): string {
  if (isAbsolute(filePath)) {
    return resolve(filePath);
  }
  return resolve(process.cwd(), filePath);
}

function readJsonFile(filePath: string): unknown {
  if (!existsSync(filePath)) {
    return {};
  }
  const raw = readFileSync(filePath, "utf8");
  if (raw.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${filePath}: ${reason}`);
  }
}

function asCoreConfig(value: unknown): OpenFoalCoreConfig {
  if (!isPlainObject(value)) {
    return {};
  }
  return value as OpenFoalCoreConfig;
}

function substituteString(value: string, env: EnvMap, configPath: string): string {
  if (!value.includes("$")) {
    return value;
  }

  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char !== "$") {
      chunks.push(char);
      continue;
    }

    const next = value[i + 1];
    const afterNext = value[i + 2];

    if (next === "$" && afterNext === "{") {
      const start = i + 3;
      const end = value.indexOf("}", start);
      if (end !== -1) {
        const name = value.slice(start, end);
        if (ENV_VAR_NAME_PATTERN.test(name)) {
          chunks.push(`\${${name}}`);
          i = end;
          continue;
        }
      }
    }

    if (next === "{") {
      const start = i + 2;
      const end = value.indexOf("}", start);
      if (end !== -1) {
        const name = value.slice(start, end);
        if (ENV_VAR_NAME_PATTERN.test(name)) {
          const envValue = env[name];
          if (envValue === undefined || envValue === "") {
            throw new MissingConfigEnvVarError(name, configPath);
          }
          chunks.push(envValue);
          i = end;
          continue;
        }
      }
    }

    chunks.push(char);
  }
  return chunks.join("");
}

function substituteAny(value: unknown, env: EnvMap, configPath: string): unknown {
  if (typeof value === "string") {
    return substituteString(value, env, configPath);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => substituteAny(item, env, `${configPath}[${index}]`));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const childPath = configPath.length > 0 ? `${configPath}.${key}` : key;
      out[key] = substituteAny(child, env, childPath);
    }
    return out;
  }
  return value;
}

function resolveConfigEnvVars(config: unknown, env: EnvMap): unknown {
  return substituteAny(config, env, "");
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }
    merged[key] = deepMerge((base as Record<string, unknown>)[key], value);
  }
  return merged;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
