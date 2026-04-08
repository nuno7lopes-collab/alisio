import type { AlisioConfig } from "../../config/config.js";

export function createPerSenderSessionConfig(
  overrides: Partial<NonNullable<AlisioConfig["session"]>> = {},
): NonNullable<AlisioConfig["session"]> {
  return {
    mainKey: "main",
    scope: "per-sender",
    ...overrides,
  };
}
