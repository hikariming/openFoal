import {
  getEnvApiKey,
  getModel,
  registerBuiltInApiProviders,
  type Model
} from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import {
  loadOpenFoalCoreConfig,
  type OpenFoalLlmModelConfig,
  type OpenFoalLlmProviderConfig
} from "./config.js";
import { asString, firstNonEmpty, isRecord, type PiCoreOptions, type PiRuntimeSettings, type PiRuntimeSettingsOptions } from "./shared.js";

declare const process: any;

let piProvidersRegistered = false;

export function ensurePiProviders(): void {
  if (piProvidersRegistered) {
    return;
  }
  registerBuiltInApiProviders();
  piProvidersRegistered = true;
}

export function resolvePiRuntimeSettings(options: PiRuntimeSettingsOptions = {}): PiRuntimeSettings {
  const env = options.env ?? process.env;
  const config = loadOpenFoalCoreConfig({
    configPath: options.configPath,
    policyPath: options.policyPath,
    env
  });
  const modelRef = firstNonEmpty(options.modelRef, config.llm?.defaultModelRef, env.OPENFOAL_PI_MODEL_REF);
  const modelConfig = modelRef ? config.llm?.models?.[modelRef] : undefined;
  const provider = firstNonEmpty(modelConfig?.provider, options.provider, config.llm?.defaultProvider, env.OPENFOAL_PI_PROVIDER);
  const modelId = firstNonEmpty(modelConfig?.modelId, options.modelId, config.llm?.defaultModel, env.OPENFOAL_PI_MODEL);
  const providerConfig = mergeProviderConfig(
    provider ? config.llm?.providers?.[provider] : undefined,
    modelConfig,
    firstNonEmpty(options.baseUrl, env.OPENFOAL_PI_BASE_URL)
  );

  return {
    config,
    modelRef,
    provider,
    modelId,
    model: resolvePiModel(provider, modelId, providerConfig),
    apiKeys: collectApiKeys(config, env, options.apiKey, provider, firstNonEmpty(modelConfig?.apiKey))
  };
}

export function resolveApiKey(provider: string, settings: PiRuntimeSettings, options: PiCoreOptions): string | undefined {
  const explicit = firstNonEmpty(options.apiKey, process.env.OPENFOAL_PI_API_KEY);
  if (explicit) {
    return explicit;
  }

  const configured = settings.apiKeys[provider] ?? settings.apiKeys._default;
  if (configured) {
    return configured;
  }

  const knownProviderKey = getEnvApiKey(provider);
  if (knownProviderKey) {
    return knownProviderKey;
  }

  const customEnvMap: Record<string, string> = {
    kimi: "KIMI_API_KEY",
    moonshot: "MOONSHOT_API_KEY",
    "kimi-coding": "KIMI_API_KEY"
  };
  const envName = customEnvMap[provider];
  const envValue = envName ? firstNonEmpty(process.env[envName]) : undefined;
  return envValue;
}

export function resolvePiStreamFn(options: PiCoreOptions): StreamFn | undefined {
  if (options.streamFn) {
    return options.streamFn as StreamFn;
  }
  return undefined;
}

function mergeProviderConfig(
  providerConfig: OpenFoalLlmProviderConfig | undefined,
  modelConfig: OpenFoalLlmModelConfig | undefined,
  baseUrl: string | undefined
): OpenFoalLlmProviderConfig | undefined {
  const modelOverride = toProviderConfig(modelConfig);
  if (!providerConfig && !modelOverride && !baseUrl) {
    return undefined;
  }
  const merged: OpenFoalLlmProviderConfig = {
    ...(providerConfig ?? {}),
    ...(modelOverride ?? {})
  };
  if (baseUrl) {
    merged.baseUrl = baseUrl;
  }
  return merged;
}

function toProviderConfig(modelConfig: OpenFoalLlmModelConfig | undefined): OpenFoalLlmProviderConfig | undefined {
  if (!modelConfig) {
    return undefined;
  }
  const out: OpenFoalLlmProviderConfig = {};
  if (modelConfig.api) {
    out.api = modelConfig.api;
  }
  if (modelConfig.baseUrl) {
    out.baseUrl = modelConfig.baseUrl;
  }
  if (modelConfig.apiKey) {
    out.apiKey = modelConfig.apiKey;
  }
  if (modelConfig.headers) {
    out.headers = modelConfig.headers;
  }
  if (modelConfig.reasoning !== undefined) {
    out.reasoning = modelConfig.reasoning;
  }
  if (modelConfig.input) {
    out.input = modelConfig.input;
  }
  if (modelConfig.contextWindow !== undefined) {
    out.contextWindow = modelConfig.contextWindow;
  }
  if (modelConfig.maxTokens !== undefined) {
    out.maxTokens = modelConfig.maxTokens;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function resolvePiModel(
  provider: string | undefined,
  modelId: string | undefined,
  providerConfig: OpenFoalLlmProviderConfig | undefined
): Model<any> | undefined {
  if (!provider || !modelId) {
    return undefined;
  }

  ensurePiProviders();
  const needsCustomModel = Boolean(providerConfig?.baseUrl || providerConfig?.api || providerConfig?.headers);
  let builtinModel: Model<any> | undefined;
  try {
    builtinModel = getModel(provider as any, modelId as any);
  } catch {
    builtinModel = undefined;
  }

  if (!needsCustomModel && builtinModel) {
    return builtinModel;
  }
  if (!providerConfig && !builtinModel) {
    return undefined;
  }

  return createConfiguredModel(provider, modelId, providerConfig, builtinModel);
}

function createConfiguredModel(
  provider: string,
  modelId: string,
  providerConfig: OpenFoalLlmProviderConfig | undefined,
  builtinModel: Model<any> | undefined
): Model<any> {
  const api = providerConfig?.api ?? builtinModel?.api ?? "openai-completions";
  const input = providerConfig?.input ?? builtinModel?.input ?? ["text"];
  const headers = mergeHeaders((builtinModel as Record<string, unknown> | undefined)?.headers, providerConfig?.headers);
  const baseUrl = firstNonEmpty(
    providerConfig?.baseUrl,
    asString((builtinModel as Record<string, unknown> | undefined)?.baseUrl)
  );
  const modelRecord: Record<string, unknown> = {
    id: modelId,
    name: builtinModel?.name ?? `${provider}/${modelId}`,
    api,
    provider,
    reasoning: providerConfig?.reasoning ?? builtinModel?.reasoning ?? false,
    input,
    cost: builtinModel?.cost ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    contextWindow: providerConfig?.contextWindow ?? builtinModel?.contextWindow ?? 128000,
    maxTokens: providerConfig?.maxTokens ?? builtinModel?.maxTokens ?? 16384
  };
  if (baseUrl) {
    modelRecord.baseUrl = baseUrl;
  }
  if (headers) {
    modelRecord.headers = headers;
  }
  return modelRecord as unknown as Model<any>;
}

function collectApiKeys(
  config: { llm?: { providers?: Record<string, OpenFoalLlmProviderConfig>; models?: Record<string, OpenFoalLlmModelConfig> } },
  env: Record<string, string | undefined>,
  explicitApiKey: string | undefined,
  activeProvider: string | undefined,
  activeModelApiKey: string | undefined
): Record<string, string> {
  const keys: Record<string, string> = {};
  const providers = config.llm?.providers ?? {};
  for (const [providerName, providerConfig] of Object.entries(providers)) {
    const key = firstNonEmpty(providerConfig.apiKey);
    if (key) {
      keys[providerName] = key;
    }
  }

  const models = config.llm?.models ?? {};
  for (const modelConfig of Object.values(models)) {
    const providerName = firstNonEmpty(modelConfig.provider);
    const key = firstNonEmpty(modelConfig.apiKey);
    if (providerName && key && !keys[providerName]) {
      keys[providerName] = key;
    }
  }

  const modelKey = firstNonEmpty(activeModelApiKey);
  if (modelKey) {
    if (activeProvider) {
      keys[activeProvider] = modelKey;
    } else {
      keys._default = modelKey;
    }
  }

  const explicit = firstNonEmpty(explicitApiKey, env.OPENFOAL_PI_API_KEY);
  if (explicit) {
    if (activeProvider) {
      keys[activeProvider] = explicit;
    } else {
      keys._default = explicit;
    }
  }

  return keys;
}

function mergeHeaders(
  base: unknown,
  override: Record<string, string> | undefined
): Record<string, string> | undefined {
  const baseRecord: Record<string, string> = {};
  if (isRecord(base)) {
    for (const [key, value] of Object.entries(base)) {
      if (typeof value === "string") {
        baseRecord[key] = value;
      }
    }
  }
  if (!override || Object.keys(override).length === 0) {
    return Object.keys(baseRecord).length > 0 ? baseRecord : undefined;
  }
  return { ...baseRecord, ...override };
}
