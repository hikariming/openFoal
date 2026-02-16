import type { ModelSecretRecord, ModelSecretRepository } from "../../../../packages/storage/dist/index.js";
import type { Principal } from "../auth.js";

export type GatewayLlmOptions = {
  modelRef?: string;
  provider?: string;
  modelId?: string;
  apiKey?: string;
  baseUrl?: string;
};

export async function resolveRunLlmOptions(input: {
  requested?: GatewayLlmOptions;
  principal?: Principal;
  preferSecretConfig?: boolean;
  tenantId: string;
  workspaceId: string;
  modelSecretRepo: ModelSecretRepository;
}): Promise<GatewayLlmOptions | undefined> {
  const requested: GatewayLlmOptions = input.requested ? { ...input.requested } : {};
  if (requested.provider) {
    requested.provider = normalizeLlmProvider(requested.provider);
  }
  if (input.principal) {
    delete requested.apiKey;
  }

  const providerHint = requested.provider;
  const providerCandidates = providerHint ? resolveProviderCandidates(providerHint) : [];
  let secret: ModelSecretRecord | undefined;
  if (providerCandidates.length > 0) {
    for (const candidate of providerCandidates) {
      secret = await input.modelSecretRepo.getForRun({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        provider: candidate
      });
      if (secret) {
        break;
      }
    }
  } else {
    secret = await input.modelSecretRepo.getForRun({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId
    });
  }
  if (!secret && providerCandidates.length > 0) {
    secret = await input.modelSecretRepo.getForRun({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId
    });
  }
  if (!secret) {
    return Object.keys(requested).length > 0 ? requested : undefined;
  }

  const preferSecretConfig = input.preferSecretConfig === true;
  const merged: GatewayLlmOptions = {
    ...(Object.keys(requested).length > 0 ? requested : {}),
    provider: preferSecretConfig ? secret.provider ?? requested.provider : requested.provider ?? secret.provider,
    modelId: preferSecretConfig ? secret.modelId ?? requested.modelId : requested.modelId ?? secret.modelId,
    baseUrl: preferSecretConfig ? secret.baseUrl ?? requested.baseUrl : requested.baseUrl ?? secret.baseUrl,
    apiKey: secret.apiKey
  };
  return merged;
}

const PROVIDER_CANONICALS = ["openai", "anthropic", "gemini", "deepseek", "qwen", "doubao", "openrouter", "ollama"] as const;
const KIMI_PROVIDER_ALIASES = ["moonshot", "moonshotai", "kimi-k2.5", "kimi-k2p5", "kimi-k2", "k2.5", "k2p5"] as const;

export function normalizeLlmProvider(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (normalized.length === 0) {
    return "openai";
  }
  if (
    normalized === "kimi" ||
    normalized.startsWith("kimi-") ||
    normalized.startsWith("kimi/") ||
    normalized.includes("moonshot") ||
    KIMI_PROVIDER_ALIASES.includes(normalized as (typeof KIMI_PROVIDER_ALIASES)[number])
  ) {
    return "kimi";
  }
  for (const provider of PROVIDER_CANONICALS) {
    if (normalized === provider || normalized.startsWith(`${provider}-`) || normalized.startsWith(`${provider}/`)) {
      return provider;
    }
  }
  return normalized;
}

export function resolveProviderCandidates(provider: string): string[] {
  const raw = provider.trim().toLowerCase().replace(/[\s_]+/g, "-");
  const canonical = normalizeLlmProvider(provider);
  const out = new Set<string>();
  if (raw.length > 0) {
    out.add(raw);
  }
  out.add(canonical);
  if (canonical === "kimi") {
    for (const alias of KIMI_PROVIDER_ALIASES) {
      out.add(alias);
    }
  }
  return Array.from(out);
}
