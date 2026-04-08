import { getRuntimeConfigSnapshot, type AlisioConfig } from "../../config/config.js";

export function resolveSkillRuntimeConfig(config?: AlisioConfig): AlisioConfig | undefined {
  return getRuntimeConfigSnapshot() ?? config;
}
