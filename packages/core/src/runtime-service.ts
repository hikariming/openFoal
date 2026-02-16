import type { CoreService, RuntimeCoreOptions } from "./shared.js";
import { createLegacyRuntimeCoreService } from "./legacy-service.js";
import { createPiCoreService } from "./pi-service.js";

declare const process: any;

export function createRuntimeCoreService(options: RuntimeCoreOptions = {}): CoreService {
  const engine = resolveEngine(options.engine);
  if (engine === "legacy") {
    return createLegacyRuntimeCoreService(options);
  }
  if (engine === "pi") {
    return createPiCoreService(options);
  }
  try {
    return createPiCoreService(options);
  } catch {
    return createLegacyRuntimeCoreService(options);
  }
}

export function resolveEngine(engine: RuntimeCoreOptions["engine"]): "pi" | "legacy" | "auto" {
  if (engine) {
    return engine;
  }

  const fromEnv = process.env.OPENFOAL_CORE_ENGINE;
  if (fromEnv === "legacy" || fromEnv === "pi" || fromEnv === "auto") {
    return fromEnv;
  }

  const nodeMajor = Number(String(process.versions?.node ?? "0").split(".")[0] ?? "0");
  if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
    return "legacy";
  }
  return "legacy";
}
