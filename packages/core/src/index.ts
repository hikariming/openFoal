import { createLocalToolExecutor, type ToolExecutor } from "../../../packages/tool-executor/dist/index.js";
import { createLegacyRuntimeCoreService } from "./legacy-service.js";
import { resolvePiRuntimeSettings } from "./pi-model.js";
import { createPiCoreService } from "./pi-service.js";
import { createRuntimeCoreService } from "./runtime-service.js";

export type { ToolCall, ToolContext, ToolExecutor, ToolResult } from "../../../packages/tool-executor/dist/index.js";

export {
  type ActiveRun,
  type CoreContinueInput,
  type CoreEvent,
  type CoreRunInput,
  type CoreService,
  type ParsedDirective,
  type ParsedInput,
  type PiCoreOptions,
  type PiRuntimeSettings,
  type PiRuntimeSettingsOptions,
  type RunState,
  type RuntimeCoreOptions,
  type RuntimeMode
} from "./shared.js";

export function createBuiltinToolExecutor(): ToolExecutor {
  return createLocalToolExecutor();
}

export { createRuntimeCoreService, createPiCoreService, createLegacyRuntimeCoreService, resolvePiRuntimeSettings };

export { MissingConfigEnvVarError, loadOpenFoalCoreConfig } from "./config.js";
export type {
  EnvMap,
  OpenFoalCoreConfig,
  OpenFoalLlmModelConfig,
  OpenFoalLlmProviderConfig,
  OpenFoalModelApi
} from "./config.js";
