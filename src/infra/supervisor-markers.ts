import { legacyEnvKey, readEnv } from "./env.js";

const SUPERVISOR_HINTS = {
  launchd: [
    "LAUNCH_JOB_LABEL",
    "LAUNCH_JOB_NAME",
    "XPC_SERVICE_NAME",
    "ALISIO_LAUNCHD_LABEL",
    legacyEnvKey("LAUNCHD_LABEL"),
  ],
  systemd: [
    "ALISIO_SYSTEMD_UNIT",
    legacyEnvKey("SYSTEMD_UNIT"),
    "INVOCATION_ID",
    "SYSTEMD_EXEC_PID",
    "JOURNAL_STREAM",
  ],
  schtasks: ["ALISIO_WINDOWS_TASK_NAME", legacyEnvKey("WINDOWS_TASK_NAME")],
} as const;

export const SUPERVISOR_HINT_ENV_VARS = [
  ...SUPERVISOR_HINTS.launchd,
  ...SUPERVISOR_HINTS.systemd,
  ...SUPERVISOR_HINTS.schtasks,
  "ALISIO_SERVICE_MARKER",
  legacyEnvKey("SERVICE_MARKER"),
  "ALISIO_SERVICE_KIND",
  legacyEnvKey("SERVICE_KIND"),
] as const;

export type RespawnSupervisor = "launchd" | "systemd" | "schtasks";

function hasAnyHint(env: NodeJS.ProcessEnv, keys: readonly string[]): boolean {
  return keys.some((key) => {
    const value = env[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function detectRespawnSupervisor(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): RespawnSupervisor | null {
  if (platform === "darwin") {
    return hasAnyHint(env, SUPERVISOR_HINTS.launchd) ? "launchd" : null;
  }
  if (platform === "linux") {
    return hasAnyHint(env, SUPERVISOR_HINTS.systemd) ? "systemd" : null;
  }
  if (platform === "win32") {
    if (hasAnyHint(env, SUPERVISOR_HINTS.schtasks)) {
      return "schtasks";
    }
    const marker = readEnv("ALISIO_SERVICE_MARKER", {
      env,
      fallback: legacyEnvKey("SERVICE_MARKER"),
      description: "service marker",
    })?.trim();
    const serviceKind = readEnv("ALISIO_SERVICE_KIND", {
      env,
      fallback: legacyEnvKey("SERVICE_KIND"),
      description: "service kind",
    })?.trim();
    return marker && serviceKind === "gateway" ? "schtasks" : null;
  }
  return null;
}
