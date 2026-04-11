import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export function resolveTaskStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicitCanonical = env.ALISIO_STATE_DIR?.trim();
  if (explicitCanonical) {
    return resolveStateDir(env);
  }
  const explicitLegacy = env.ALISIO_STATE_DIR?.trim();
  if (explicitLegacy) {
    if (env.VITEST || env.NODE_ENV === "test") {
      return resolveStateDir({
        ...env,
        ALISIO_STATE_DIR: explicitLegacy,
      });
    }
    return resolveStateDir(env);
  }
  if (env.VITEST || env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), "alisio-test-state", String(process.pid));
  }
  return resolveStateDir(env);
}

export function resolveTaskRegistryDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveTaskStateDir(env), "tasks");
}

export function resolveTaskRegistrySqlitePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveTaskRegistryDir(env), "runs.sqlite");
}
