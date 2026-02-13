import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  MissingConfigEnvVarError,
  loadOpenFoalCoreConfig,
  resolvePiRuntimeSettings
} from "../../packages/core/dist/index.js";

test("core config loads json and resolves ${ENV_VAR} values", () => {
  const dir = mkdtempSync(join(tmpdir(), "openfoal-core-config-"));
  const configPath = join(dir, "openfoal.json");

  try {
    writeFileSync(
      configPath,
      JSON.stringify({
        llm: {
          defaultProvider: "kimi",
          defaultModel: "k2p5",
          providers: {
            kimi: {
              api: "openai-completions",
              baseUrl: "${KIMI_BASE_URL}",
              apiKey: "${KIMI_API_KEY}"
            }
          }
        }
      })
    );

    const config = loadOpenFoalCoreConfig({
      configPath,
      env: {
        HOME: dir,
        KIMI_BASE_URL: "https://api.moonshot.cn/v1",
        KIMI_API_KEY: "sk-kimi"
      }
    });

    assert.equal(config.llm?.defaultProvider, "kimi");
    assert.equal(config.llm?.providers?.kimi?.baseUrl, "https://api.moonshot.cn/v1");
    assert.equal(config.llm?.providers?.kimi?.apiKey, "sk-kimi");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("core config throws when referenced env var is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "openfoal-core-config-"));
  const configPath = join(dir, "openfoal.json");

  try {
    writeFileSync(
      configPath,
      JSON.stringify({
        llm: {
          providers: {
            kimi: {
              apiKey: "${KIMI_API_KEY}"
            }
          }
        }
      })
    );

    assert.throws(
      () =>
        loadOpenFoalCoreConfig({
          configPath,
          env: {
            HOME: dir
          }
        }),
      MissingConfigEnvVarError
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("core config merges personal config and enterprise policy json", () => {
  const dir = mkdtempSync(join(tmpdir(), "openfoal-core-policy-"));
  const configPath = join(dir, "openfoal.json");
  const policyPath = join(dir, "policy.json");

  try {
    writeFileSync(
      configPath,
      JSON.stringify({
        llm: {
          defaultProvider: "kimi",
          defaultModel: "k2p5",
          providers: {
            kimi: {
              api: "openai-completions",
              baseUrl: "https://api.moonshot.cn/v1"
            }
          }
        }
      })
    );

    writeFileSync(
      policyPath,
      JSON.stringify({
        llm: {
          defaultModel: "kimi-k1.5",
          providers: {
            kimi: {
              headers: {
                "x-tenant": "acme"
              }
            }
          }
        }
      })
    );

    const config = loadOpenFoalCoreConfig({
      configPath,
      policyPath,
      env: {
        HOME: dir
      }
    });

    assert.equal(config.llm?.defaultProvider, "kimi");
    assert.equal(config.llm?.defaultModel, "kimi-k1.5");
    assert.equal(config.llm?.providers?.kimi?.baseUrl, "https://api.moonshot.cn/v1");
    assert.equal(config.llm?.providers?.kimi?.headers?.["x-tenant"], "acme");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pi runtime settings prefer explicit options, then config, then env fallback", () => {
  const dir = mkdtempSync(join(tmpdir(), "openfoal-core-runtime-"));
  const configPath = join(dir, "openfoal.json");

  try {
    writeFileSync(
      configPath,
      JSON.stringify({
        llm: {
          defaultProvider: "kimi",
          defaultModel: "k2p5",
          providers: {
            kimi: {
              api: "openai-completions",
              baseUrl: "https://api.moonshot.cn/v1",
              apiKey: "${KIMI_API_KEY}"
            }
          }
        }
      })
    );

    const fromConfig = resolvePiRuntimeSettings({
      configPath,
      env: {
        HOME: dir,
        OPENFOAL_PI_PROVIDER: "openai",
        OPENFOAL_PI_MODEL: "gpt-4o-mini",
        KIMI_API_KEY: "sk-from-env"
      }
    });

    assert.equal(fromConfig.provider, "kimi");
    assert.equal(fromConfig.modelId, "k2p5");
    assert.equal(fromConfig.model?.provider, "kimi");
    assert.equal(fromConfig.apiKeys.kimi, "sk-from-env");

    const explicit = resolvePiRuntimeSettings({
      provider: "openai",
      modelId: "gpt-4o-mini",
      configPath,
      env: {
        HOME: dir,
        KIMI_API_KEY: "sk-from-env"
      }
    });

    assert.equal(explicit.provider, "openai");
    assert.equal(explicit.modelId, "gpt-4o-mini");
    assert.equal(explicit.model?.provider, "openai");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pi runtime settings support modelRef + llm.models", () => {
  const dir = mkdtempSync(join(tmpdir(), "openfoal-core-modelref-"));
  const configPath = join(dir, "openfoal.json");

  try {
    writeFileSync(
      configPath,
      JSON.stringify({
        llm: {
          defaultModelRef: "kimi-default",
          providers: {
            kimi: {
              api: "openai-completions"
            },
            openai: {
              api: "openai-completions"
            }
          },
          models: {
            "kimi-default": {
              provider: "kimi",
              modelId: "k2p5",
              baseUrl: "https://api.moonshot.cn/v1",
              apiKey: "${KIMI_API_KEY}"
            },
            "openai-fast": {
              provider: "openai",
              modelId: "gpt-4o-mini"
            }
          }
        }
      })
    );

    const fromDefaultRef = resolvePiRuntimeSettings({
      configPath,
      env: {
        HOME: dir,
        KIMI_API_KEY: "sk-kimi"
      }
    });

    assert.equal(fromDefaultRef.modelRef, "kimi-default");
    assert.equal(fromDefaultRef.provider, "kimi");
    assert.equal(fromDefaultRef.modelId, "k2p5");
    assert.equal(fromDefaultRef.apiKeys.kimi, "sk-kimi");

    const fromExplicitRef = resolvePiRuntimeSettings({
      configPath,
      modelRef: "openai-fast",
      env: {
        HOME: dir,
        KIMI_API_KEY: "sk-kimi"
      }
    });

    assert.equal(fromExplicitRef.modelRef, "openai-fast");
    assert.equal(fromExplicitRef.provider, "openai");
    assert.equal(fromExplicitRef.modelId, "gpt-4o-mini");

    const modelRefWins = resolvePiRuntimeSettings({
      configPath,
      modelRef: "kimi-default",
      provider: "openai",
      modelId: "gpt-4o-mini",
      env: {
        HOME: dir,
        KIMI_API_KEY: "sk-kimi"
      }
    });

    assert.equal(modelRefWins.provider, "kimi");
    assert.equal(modelRefWins.modelId, "k2p5");

    const missingRefFallsBack = resolvePiRuntimeSettings({
      configPath,
      modelRef: "missing-model-ref",
      provider: "openai",
      modelId: "gpt-4o-mini",
      env: {
        HOME: dir,
        KIMI_API_KEY: "sk-kimi"
      }
    });

    assert.equal(missingRefFallsBack.provider, "openai");
    assert.equal(missingRefFallsBack.modelId, "gpt-4o-mini");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
